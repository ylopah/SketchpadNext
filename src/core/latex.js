import { clipParametricLineToRect } from "./geometry.js";
import { parseMathText, plainMathText } from "./text-format.js";

const EPSILON = 1e-9;
const MAX_COORDINATE_FACTOR = 20;

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= EPSILON ? 0 : value;
  return normalized.toFixed(digits).replace(/\.?0+$/, "");
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizeView(view) {
  const x = Number(view?.x);
  const y = Number(view?.y);
  const width = Number(view?.width);
  const height = Number(view?.height);
  const aspect = height / width;
  if (![x, y, width, height].every(Number.isFinite)
    || Math.max(Math.abs(x), Math.abs(y), width, height) > 1e12
    || width <= EPSILON || height <= EPSILON
    || !Number.isFinite(aspect) || aspect < 0.01 || aspect > 100) {
    return { x: 0, y: 0, width: 1200, height: 720 };
  }
  return { x, y, width, height };
}

function normalizeHexColor(value) {
  const source = String(value || "").trim();
  const short = source.match(/^#([0-9a-f]{3})$/i);
  if (short) return short[1].split("").map((character) => character + character).join("").toUpperCase();
  const full = source.match(/^#([0-9a-f]{6})$/i);
  return full ? full[1].toUpperCase() : null;
}

export function escapeLatexText(value) {
  const replacements = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "#": "\\#",
    "_": "\\_",
    "%": "\\%",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
    "\n": "\\\\",
  };
  return Array.from(String(value ?? "")).map((character) => replacements[character] || character).join("");
}

function formattedTextLatex(value, options = {}) {
  return parseMathText(value, options).map((segment) => {
    const escaped = escapeLatexText(segment.text);
    if (segment.script === "sub") return "\\textsubscript{" + escaped + "}";
    if (segment.script === "super") return "\\textsuperscript{" + escaped + "}";
    return escaped;
  }).join("");
}

function pointLabelLatex(value) {
  const source = String(value ?? "").replace(/[\r\n]+/g, " ");
  return formattedTextLatex(source, { legacyBracketSubscript: true });
}

function clipSegmentToRect(a, b, rect) {
  if (!finitePoint(a) || !finitePoint(b)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  let minimum = 0;
  let maximum = 1;
  const checks = [
    [-dx, a.x - rect.x1],
    [dx, rect.x2 - a.x],
    [-dy, a.y - rect.y1],
    [dy, rect.y2 - a.y],
  ];
  for (const [direction, offset] of checks) {
    if (Math.abs(direction) <= EPSILON) {
      if (offset < 0) return null;
      continue;
    }
    const ratio = offset / direction;
    if (!Number.isFinite(ratio)) return null;
    if (direction < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return null;
  }
  const result = {
    a: { x: a.x + dx * minimum, y: a.y + dy * minimum },
    b: { x: a.x + dx * maximum, y: a.y + dy * maximum },
  };
  return finitePoint(result.a) && finitePoint(result.b) ? result : null;
}

function clippedPolyline(points, rect) {
  const paths = [];
  let current = [];
  const samePoint = (first, second) => first && second
    && Math.hypot(first.x - second.x, first.y - second.y) <= 1e-7;
  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegmentToRect(points[index - 1], points[index], rect);
    if (!clipped) {
      if (current.length > 1) paths.push(current);
      current = [];
      continue;
    }
    if (!samePoint(current.at(-1), clipped.a)) {
      if (current.length > 1) paths.push(current);
      current = [clipped.a];
    }
    current.push(clipped.b);
  }
  if (current.length > 1) paths.push(current);
  return paths;
}

function textForObject(documentModel, object) {
  try {
    if (object.type === "text") return object.content;
    if (object.type === "measurement") return documentModel.getMeasurementText(object);
    if (["parameter", "calculation"].includes(object.type)) return documentModel.getValueText(object);
    if (object.type === "table") {
      const table = documentModel.getTableData(object);
      if (!table) return null;
      return [table.headers.join("    "), ...table.rows.map((row) => row.join("    "))].join("\n");
    }
  } catch {
    return null;
  }
  return null;
}

export function createTikzExport(documentModel, options = {}) {
  if (!documentModel || typeof documentModel.objectsInPaintOrder !== "function") {
    throw new TypeError("需要有效的 GeometryDocument");
  }
  const viewport = normalizeView(options.view);
  const targetWidthCm = Math.max(4, Math.min(40, Number(options.targetWidthCm) || 12));
  const scale = targetWidthCm / viewport.width;
  const canvasWidthPx = Number.isFinite(Number(options.canvasWidthPx)) && Number(options.canvasWidthPx) > 0
    ? Number(options.canvasWidthPx)
    : viewport.width;
  const cssScalePt = targetWidthCm * 28.4527 / canvasWidthPx;
  const defaultPointLabelFontSize = Math.max(
    8,
    Math.min(48, Number(options.pointLabelFontSize) || 17),
  );
  const targetHeightCm = viewport.height * scale;
  if (!Number.isFinite(targetHeightCm) || targetHeightCm > 500) {
    throw new RangeError("当前视图比例过大，无法安全生成 TikZ");
  }
  const rect = {
    x1: viewport.x,
    y1: viewport.y,
    x2: viewport.x + viewport.width,
    y2: viewport.y + viewport.height,
  };
  const safeRect = {
    x1: viewport.x - viewport.width * MAX_COORDINATE_FACTOR,
    y1: viewport.y - viewport.height * MAX_COORDINATE_FACTOR,
    x2: viewport.x + viewport.width * (MAX_COORDINATE_FACTOR + 1),
    y2: viewport.y + viewport.height * (MAX_COORDINATE_FACTOR + 1),
  };
  const colors = new Map();
  const commands = [];
  const warnings = [];
  let exportedCount = 0;
  let skippedCount = 0;
  let hasUnicodeText = false;

  const colorFor = (value, fallback = "#334155") => {
    const hex = normalizeHexColor(value) || normalizeHexColor(fallback) || "000000";
    if (!colors.has(hex)) colors.set(hex, "spcolor" + (colors.size + 1));
    return colors.get(hex);
  };
  const transformPoint = (point) => ({
    x: (point.x - viewport.x) * scale,
    y: (viewport.y + viewport.height - point.y) * scale,
  });
  const isSafePoint = (point) => {
    if (!finitePoint(point)
      || point.x < safeRect.x1 || point.x > safeRect.x2
      || point.y < safeRect.y1 || point.y > safeRect.y2) return false;
    const transformed = transformPoint(point);
    return finitePoint(transformed)
      && Math.max(Math.abs(transformed.x), Math.abs(transformed.y)) <= 500;
  };
  const coordinate = (point) => {
    const transformed = transformPoint(point);
    const x = formatNumber(transformed.x);
    const y = formatNumber(transformed.y);
    if (x === null || y === null
      || Math.max(Math.abs(transformed.x), Math.abs(transformed.y)) > 500) {
      throw new RangeError("对象坐标超出 TikZ 安全范围");
    }
    return "(" + x + "," + y + ")";
  };
  const radiusCm = (radius) => {
    const transformed = Math.abs(radius) * scale;
    if (!Number.isFinite(transformed) || transformed > 500) {
      throw new RangeError("对象半径超出 TikZ 安全范围");
    }
    return formatNumber(transformed);
  };
  const lineWidthPt = (object, fallback = 2) => {
    const width = Number(object.style?.width) || fallback;
    return formatNumber(Math.max(0.2, Math.min(4, width * cssScalePt)), 3);
  };
  const shapeOptions = (object, extra = []) => {
    const values = [
      "draw=" + colorFor(object.style?.color),
      "line width=" + lineWidthPt(object) + "pt",
      "line cap=round",
      "line join=round",
    ];
    if (object.style?.dash === "dashed") {
      values.push("dash pattern=on " + formatNumber(Math.max(1, 8 * cssScalePt), 3)
        + "pt off " + formatNumber(Math.max(0.8, 6 * cssScalePt), 3) + "pt");
    }
    values.push(...extra);
    return values.join(",");
  };
  const pushPolyline = (points, object, extra = []) => {
    const clippedPaths = clippedPolyline(points, rect);
    for (const path of clippedPaths) {
      commands.push("\\draw[" + shapeOptions(object, extra) + "] "
        + path.map(coordinate).join(" -- ") + ";");
    }
    return clippedPaths.length > 0;
  };
  const arcSpecification = (geometry, radius = geometry.radius, startAngle = geometry.startAngle, signedAngle = geometry.signedAngle) => {
    return "arc[start angle=" + formatNumber(-startAngle * 180 / Math.PI)
      + ",delta angle=" + formatNumber(-signedAngle * 180 / Math.PI)
      + ",radius=" + radiusCm(radius) + "cm]";
  };
  const visibleCircle = (geometry) => {
    if (!finitePoint(geometry.center) || !Number.isFinite(geometry.radius) || geometry.radius <= EPSILON) return false;
    const maximum = Math.max(viewport.width, viewport.height) * MAX_COORDINATE_FACTOR;
    const center = transformPoint(geometry.center);
    const radius = geometry.radius * scale;
    return geometry.radius <= maximum
      && Number.isFinite(radius)
      && isSafePoint(geometry.center)
      && Math.max(Math.abs(center.x) + radius, Math.abs(center.y) + radius) <= 500;
  };

  const renderCoordinateSystem = (geometry, object) => {
    if (!isSafePoint(geometry.origin)
      || !Number.isFinite(geometry.unitX) || !Number.isFinite(geometry.unitY)
      || geometry.unitX <= EPSILON || geometry.unitY <= EPSILON) return false;
    const commandCount = commands.length;
    const gridColor = colorFor("#dbe4f0");
    const axisColor = colorFor("#64748b");
    const gridOptions = "draw=" + gridColor + ",line width="
      + formatNumber(Math.max(0.2, cssScalePt), 3) + "pt";
    if (geometry.showGrid && geometry.gridType === "polar") {
      const maximumRadius = Math.hypot(
        Math.max(Math.abs(rect.x1 - geometry.origin.x), Math.abs(rect.x2 - geometry.origin.x)),
        Math.max(Math.abs(rect.y1 - geometry.origin.y), Math.abs(rect.y2 - geometry.origin.y)),
      );
      const transformedOrigin = transformPoint(geometry.origin);
      const transformedRadius = maximumRadius * scale;
      if (Math.max(
        Math.abs(transformedOrigin.x) + transformedRadius,
        Math.abs(transformedOrigin.y) + transformedRadius,
      ) > 500) return false;
      const circleCount = Math.min(120, Math.ceil(maximumRadius / geometry.unitX));
      for (let index = 1; index <= circleCount; index += 1) {
        const gridRadius = index * geometry.unitX;
        const transformedGridRadius = Math.abs(gridRadius) * scale;
        if (!Number.isFinite(transformedGridRadius)
          || Math.max(
            Math.abs(transformedOrigin.x) + transformedGridRadius,
            Math.abs(transformedOrigin.y) + transformedGridRadius,
          ) > 500) continue;
        commands.push("\\draw[" + gridOptions + "] " + coordinate(geometry.origin)
          + " circle[radius=" + radiusCm(gridRadius) + "cm];");
      }
      for (let index = 0; index < 24; index += 1) {
        const angle = index * Math.PI / 12;
        const delta = { x: Math.cos(angle) * maximumRadius, y: Math.sin(angle) * maximumRadius };
        commands.push("\\draw[" + gridOptions + "] "
          + coordinate({ x: geometry.origin.x - delta.x, y: geometry.origin.y - delta.y })
          + " -- " + coordinate({ x: geometry.origin.x + delta.x, y: geometry.origin.y + delta.y }) + ";");
      }
    } else if (geometry.showGrid) {
      const startX = Math.floor((rect.x1 - geometry.origin.x) / geometry.unitX);
      const endX = Math.ceil((rect.x2 - geometry.origin.x) / geometry.unitX);
      const startY = Math.floor((rect.y1 - geometry.origin.y) / geometry.unitY);
      const endY = Math.ceil((rect.y2 - geometry.origin.y) / geometry.unitY);
      for (let index = startX; index <= endX && index - startX < 240; index += 1) {
        const x = geometry.origin.x + index * geometry.unitX;
        const first = { x, y: rect.y1 };
        const second = { x, y: rect.y2 };
        if ([first, second].every(isSafePoint)) {
          commands.push("\\draw[" + gridOptions + "] " + coordinate(first)
            + " -- " + coordinate(second) + ";");
        }
      }
      for (let index = startY; index <= endY && index - startY < 240; index += 1) {
        const y = geometry.origin.y + index * geometry.unitY;
        const first = { x: rect.x1, y };
        const second = { x: rect.x2, y };
        if ([first, second].every(isSafePoint)) {
          commands.push("\\draw[" + gridOptions + "] " + coordinate(first)
            + " -- " + coordinate(second) + ";");
        }
      }
    }
    const axisOptions = "draw=" + axisColor + ",line width="
      + formatNumber(Math.max(0.25, 1.5 * cssScalePt), 3) + "pt";
    if (geometry.origin.y >= rect.y1 && geometry.origin.y <= rect.y2) {
      commands.push("\\draw[" + axisOptions + "] " + coordinate({ x: rect.x1, y: geometry.origin.y })
        + " -- " + coordinate({ x: rect.x2, y: geometry.origin.y }) + ";");
    }
    if (geometry.origin.x >= rect.x1 && geometry.origin.x <= rect.x2) {
      commands.push("\\draw[" + axisOptions + "] " + coordinate({ x: geometry.origin.x, y: rect.y1 })
        + " -- " + coordinate({ x: geometry.origin.x, y: rect.y2 }) + ";");
    }
    return commands.length > commandCount;
  };

  const renderPathMark = (geometry, object) => {
    if (!isSafePoint(geometry.center) || !finitePoint(geometry.direction) || !finitePoint(geometry.normal)) return false;
    let rendered = false;
    for (let index = 0; index < geometry.strokeCount; index += 1) {
      const spacing = geometry.markKind === "arrow" ? 11 : 5;
      const offset = (index - (geometry.strokeCount - 1) / 2) * spacing;
      const center = {
        x: geometry.center.x + geometry.direction.x * offset,
        y: geometry.center.y + geometry.direction.y * offset,
      };
      if (geometry.markKind === "arrow") {
        const apex = { x: center.x + geometry.direction.x * 5, y: center.y + geometry.direction.y * 5 };
        const back = { x: center.x - geometry.direction.x * 5, y: center.y - geometry.direction.y * 5 };
        const first = { x: back.x + geometry.normal.x * 5, y: back.y + geometry.normal.y * 5 };
        const second = { x: back.x - geometry.normal.x * 5, y: back.y - geometry.normal.y * 5 };
        commands.push("\\draw[" + shapeOptions(object) + "] " + coordinate(first) + " -- " + coordinate(apex)
          + " -- " + coordinate(second) + ";");
      } else {
        const first = { x: center.x - geometry.normal.x * 7, y: center.y - geometry.normal.y * 7 };
        const second = { x: center.x + geometry.normal.x * 7, y: center.y + geometry.normal.y * 7 };
        commands.push("\\draw[" + shapeOptions(object) + "] " + coordinate(first) + " -- " + coordinate(second) + ";");
      }
      rendered = true;
    }
    return rendered;
  };

  const renderAngleMark = (geometry, object) => {
    if (![geometry.vertex, geometry.start, geometry.end].every(isSafePoint)
      || !Number.isFinite(geometry.radius) || geometry.radius <= EPSILON) return false;
    const color = colorFor(object.style?.color);
    const opacity = formatNumber(Math.max(0, Math.min(1, Number(geometry.opacity) || 0)), 3);
    const fillOptions = "draw=none,fill=" + color + ",fill opacity=" + opacity;
    if (geometry.rightAngle && isSafePoint(geometry.corner)) {
      commands.push("\\path[" + fillOptions + "] "
        + [geometry.vertex, geometry.start, geometry.corner, geometry.end].map(coordinate).join(" -- ") + " -- cycle;");
      commands.push("\\draw[" + shapeOptions(object) + "] "
        + [geometry.start, geometry.corner, geometry.end].map(coordinate).join(" -- ") + ";");
      return true;
    }
    commands.push("\\path[" + fillOptions + "] "
      + coordinate(geometry.vertex) + " -- " + coordinate(geometry.start) + " "
      + arcSpecification(geometry) + " -- cycle;");
    for (let index = 0; index < geometry.strokeCount; index += 1) {
      const spacing = geometry.strokeCount > 1
        ? Math.min(5, Math.max(2, (geometry.radius - 6) / (geometry.strokeCount - 1)))
        : 0;
      const radius = Math.max(6, geometry.radius - index * spacing);
      const start = {
        x: geometry.vertex.x + Math.cos(geometry.startAngle) * radius,
        y: geometry.vertex.y + Math.sin(geometry.startAngle) * radius,
      };
      commands.push("\\draw[" + shapeOptions(object) + "] " + coordinate(start) + " "
        + arcSpecification(geometry, radius) + ";");
    }
    if (geometry.showDirection) {
      const angle = geometry.startAngle + geometry.signedAngle / 2;
      const point = {
        x: geometry.vertex.x + Math.cos(angle) * geometry.radius,
        y: geometry.vertex.y + Math.sin(angle) * geometry.radius,
      };
      const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
      const normal = { x: Math.cos(angle), y: Math.sin(angle) };
      const first = {
        x: point.x - tangent.x * 7 + normal.x * 4,
        y: point.y - tangent.y * 7 + normal.y * 4,
      };
      const second = {
        x: point.x - tangent.x * 7 - normal.x * 4,
        y: point.y - tangent.y * 7 - normal.y * 4,
      };
      if ([first, point, second].every(isSafePoint)) {
        commands.push("\\draw[" + shapeOptions(object) + "] "
          + [first, point, second].map(coordinate).join(" -- ") + ";");
      }
    }
    return true;
  };

  const renderGeometry = (geometry, object) => {
    if (!geometry) return false;
    if (geometry.kind === "coordinateSystem") return renderCoordinateSystem(geometry, object);
    if (geometry.kind === "plot") {
      return geometry.paths.map((path) => pushPolyline(path, object)).some(Boolean);
    }
    if (geometry.kind === "pathMark") return renderPathMark(geometry, object);
    if (geometry.kind === "doodle") return pushPolyline(geometry.points, object);
    if (geometry.kind === "angleMark") return renderAngleMark(geometry, object);
    if (geometry.kind === "line") {
      if (!finitePoint(geometry.a) || !finitePoint(geometry.b)) return false;
      const clipped = geometry.segment
        ? clipSegmentToRect(geometry.a, geometry.b, rect)
        : clipParametricLineToRect(geometry.a, geometry.b, rect, geometry.ray);
      if (!clipped || !finitePoint(clipped.a) || !finitePoint(clipped.b)) return false;
      commands.push("\\draw[" + shapeOptions(object) + "] "
        + coordinate(clipped.a) + " -- " + coordinate(clipped.b) + ";");
      return true;
    }
    if (geometry.kind === "circle" || geometry.kind === "circleInterior") {
      if (!visibleCircle(geometry)) return false;
      const color = colorFor(object.style?.color);
      const extra = geometry.kind === "circleInterior"
        ? ["fill=" + color, "fill opacity=" + formatNumber(Math.max(0, Math.min(1, Number(geometry.opacity) || 0)), 3)]
        : [];
      commands.push("\\draw[" + shapeOptions(object, extra) + "] " + coordinate(geometry.center)
        + " circle[radius=" + radiusCm(geometry.radius) + "cm];");
      return true;
    }
    if (geometry.kind === "arc" || geometry.kind === "arcInterior") {
      if (!visibleCircle(geometry) || !isSafePoint(geometry.start) || !isSafePoint(geometry.end)
        || !Number.isFinite(geometry.startAngle) || !Number.isFinite(geometry.signedAngle)
        || Math.abs(geometry.signedAngle) <= EPSILON) return false;
      const color = colorFor(object.style?.color);
      const extra = geometry.kind === "arcInterior"
        ? ["fill=" + color, "fill opacity=" + formatNumber(Math.max(0, Math.min(1, Number(geometry.opacity) || 0)), 3)]
        : [];
      const prefix = geometry.kind === "arcInterior" && geometry.interiorKind === "sector"
        ? coordinate(geometry.center) + " -- " + coordinate(geometry.start)
        : coordinate(geometry.start);
      const suffix = geometry.kind === "arcInterior" ? " -- cycle" : "";
      commands.push("\\draw[" + shapeOptions(object, extra) + "] " + prefix + " "
        + arcSpecification(geometry) + suffix + ";");
      return true;
    }
    return false;
  };

  for (const object of documentModel.objectsInPaintOrder()) {
    if (!object || object.hidden) continue;
    const commandCount = commands.length;
    try {
      if (object.type === "point") {
        const position = documentModel.getPointPosition(object);
        if (!isSafePoint(position)) {
          skippedCount += 1;
          warnings.push("点 " + object.id + " 的位置无效或超出安全范围");
          continue;
        }
        const color = colorFor(object.style?.color, "#000000");
        const radius = Math.max(0.025, Math.min(0.3, (Number(object.style?.radius) || 6) * scale));
        const pointOptions = [
          "draw=white",
          "fill=" + color,
          "line width=" + formatNumber(Math.max(0.25, 2 * cssScalePt), 3) + "pt",
        ];
        commands.push("\\filldraw[" + pointOptions.join(",") + "] " + coordinate(position)
          + " circle[radius=" + formatNumber(radius) + "cm];");
        if (object.style?.showLabel !== false && object.label != null) {
          const rawLabel = String(object.label).replace(/[\r\n]+/g, " ");
          hasUnicodeText ||= /[^\x00-\x7f]/.test(plainMathText(rawLabel, { legacyBracketSubscript: true }));
          const offset = object.labelOffset || { x: 12, y: -12 };
          const labelPosition = { x: position.x + Number(offset.x || 0), y: position.y + Number(offset.y || 0) };
          if (isSafePoint(labelPosition)) {
            const labelColor = colorFor("#273142");
            const labelFontSize = Math.max(
              8,
              Math.min(48, Number(object.style?.labelFontSize) || defaultPointLabelFontSize),
            );
            const labelFontSizePt = formatNumber(7 * labelFontSize / 17, 2);
            const labelLineHeightPt = formatNumber(Number(labelFontSizePt) * 8 / 7, 2);
            commands.push("\\node[anchor=base west,inner sep=0pt,text=" + labelColor
              + ",font=\\itshape\\fontsize{" + labelFontSizePt + "pt}{" + labelLineHeightPt
              + "pt}\\selectfont] at " + coordinate(labelPosition)
              + " {" + pointLabelLatex(rawLabel) + "};");
          } else {
            warnings.push("点 " + object.id + " 的标签偏移无效，已跳过标签");
          }
        }
        exportedCount += 1;
        continue;
      }
      if (["text", "measurement", "parameter", "calculation", "table"].includes(object.type)) {
        const content = textForObject(documentModel, object);
        const position = { x: Number(object.x), y: Number(object.y) };
        if (content == null || !isSafePoint(position)) {
          skippedCount += 1;
          warnings.push("文本对象 " + object.id + " 无法求值或超出安全范围");
          continue;
        }
        const raw = String(content);
        hasUnicodeText ||= /[^\x00-\x7f]/.test(plainMathText(raw, { enableScripts: true }));
        const color = colorFor(object.style?.color);
        const fontSize = Number(object.style?.fontSize) || 16;
        const fontSizePt = formatNumber(Math.max(5, Math.min(24, fontSize * scale * 28.4527)), 2);
        const lines = raw.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const linePosition = { x: position.x, y: position.y + index * fontSize * 1.35 };
          commands.push("\\node[anchor=base west,inner sep=0pt,text=" + color
            + ",font=\\fontsize{" + fontSizePt + "pt}{" + formatNumber(Number(fontSizePt) * 1.2, 2)
            + "pt}\\selectfont] at " + coordinate(linePosition)
            + " {" + (formattedTextLatex(lines[index], { enableScripts: true }) || "\\strut") + "};");
        }
        exportedCount += 1;
        continue;
      }
      if (["image", "actionButton"].includes(object.type)) {
        skippedCount += 1;
        warnings.push((object.type === "image" ? "图片" : "动作按钮") + " " + object.id + " 未包含在静态 TikZ 中");
        continue;
      }
      let geometry = null;
      try {
        geometry = documentModel.getShapeGeometry(object);
      } catch {}
      if (renderGeometry(geometry, object)) exportedCount += 1;
      else {
        skippedCount += 1;
        warnings.push("对象 " + object.id + " 的几何无效、离视图过远或暂不支持");
      }
    } catch (error) {
      commands.length = commandCount;
      skippedCount += 1;
      warnings.push("对象 " + object.id + " 导出失败或超出 TikZ 安全范围，已跳过");
    }
  }

  const colorDefinitions = [...colors.entries()].map(([hex, name]) =>
    "\\definecolor{" + name + "}{HTML}{" + hex + "}"
  );
  const preamble = [
    "% Generated by SketchpadNext.",
    "% This is a static snapshot of the current page and viewport.",
    "\\documentclass[tikz,border=4pt]{standalone}",
    "\\usepackage{xcolor}",
    ...(hasUnicodeText
      ? ["% Compile with XeLaTeX or LuaLaTeX for Unicode text.", "\\usepackage[UTF8]{ctex}"]
      : []),
    "\\usepackage{tikz}",
    ...colorDefinitions,
    "\\begin{document}",
    "\\begin{tikzpicture}[x=1cm,y=1cm,line cap=round,line join=round]",
    "\\path[use as bounding box] (0,0) rectangle (" + formatNumber(targetWidthCm) + "," + formatNumber(targetHeightCm) + ");",
    "\\clip (0,0) rectangle (" + formatNumber(targetWidthCm) + "," + formatNumber(targetHeightCm) + ");",
  ];
  const footer = [
    ...(warnings.length
      ? ["% " + warnings.length + " item(s) were skipped; see the app notification."]
      : []),
    "\\end{tikzpicture}",
    "\\end{document}",
    "",
  ];
  const code = [...preamble, ...commands, ...footer].join("\n");
  if (/\b(?:NaN|Infinity|null|undefined)\b/.test(code)) {
    throw new Error("TikZ 输出包含无效数值");
  }
  return {
    code,
    exportedCount,
    skippedCount,
    warnings,
  };
}
