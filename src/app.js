import { GeometryDocument } from "./core/document.js";
import { DocumentHistory } from "./core/history.js";
import { clipLineGeometryToView } from "./core/geometry.js";
import { clientPointToWorld, fitViewToGesture, panViewFromClientDelta, zoomViewAtClientPoint } from "./core/view.js";
import {
  angleBisectorFromCommonEndpoint,
  hasExceededDragThreshold,
  pointLinePairs,
  selectionDragIntent,
} from "./core/selection.js";
import { createTikzExport } from "./core/latex.js";
import {
  PREFERENCES_CHANGE_EVENT,
  loadPreferences,
  normalizePreferences,
  savePreferences,
} from "./core/preferences.js";
import { parseMathText } from "./core/text-format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const AUTOSAVE_KEY = "sketchpad-next.autosave.v1";
const CUSTOM_TOOLS_KEY = "sketchpad-next.custom-tools.v1";
const FILE_HANDLE_DB = "sketchpad-next.files.v1";
const FILE_HANDLE_STORE = "handles";
const CURRENT_PROJECT_HANDLE_KEY = "current-project";

function openFileHandleDatabase() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_HANDLE_STORE)) database.createObjectStore(FILE_HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberProjectHandle(handle) {
  if (!handle) return;
  try {
    const database = await openFileHandleDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(FILE_HANDLE_STORE, "readwrite");
      transaction.objectStore(FILE_HANDLE_STORE).put(handle, CURRENT_PROJECT_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("浏览器未能记住当前工程文件。", error);
  }
}

async function forgetProjectHandle() {
  try {
    const database = await openFileHandleDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(FILE_HANDLE_STORE, "readwrite");
      transaction.objectStore(FILE_HANDLE_STORE).delete(CURRENT_PROJECT_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("浏览器未能清除工程文件关联。", error);
  }
}

async function restoreProjectHandle() {
  try {
    const database = await openFileHandleDatabase();
    if (!database) return null;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(FILE_HANDLE_STORE, "readonly");
      const request = transaction.objectStore(FILE_HANDLE_STORE).get(CURRENT_PROJECT_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("浏览器未能恢复工程文件关联。", error);
    return null;
  }
}

const toolDescriptions = {
  select: "单击交叉附近创建动态交点；拖动对象移动，空白处拖框多选",
  point: "点击空白处创建自由点；点击线或圆创建约束点",
  segment: "依次选择两个点创建线段，也可直接在空白处点击",
  line: "依次选择两个点创建无限直线",
  ray: "先选射线端点，再选方向点",
  midpoint: "选择一条线段，或依次选择两个点创建动态中点",
  perpendicularBisector: "选择一条线段，或依次选择/直接点出两个点创建中垂线",
  parallel: "可先多选点和基准线后批量构造，也可依次点击一个点和一条线",
  perpendicular: "可先多选点和基准线后批量构造，也可依次点击一个点和一条线",
  angleBisector: "可先选两条共顶点边，或依次选择/点出：第一边点、顶点、第二边点",
  marker: "在角的顶点按下并向角内拖动；点击已有灰色标识可切换 1～4 道弧线",
  info: "点击对象查看类型、父对象和子对象；按住 Shift 可让信息保持显示",
  text: "点击空白处输入文本；拖动文本调整位置，双击文本可再次编辑",
  circle: "先选圆心，再选圆上一点",
  threePointCircle: "依次选择三个不共线的点创建外接圆",
};

const elements = Object.fromEntries([
  "geometryCanvas", "snapGridLayer", "traceLayer", "objectLayer", "previewLayer", "emptyState", "toast", "infoPanel",
  "documentTitle", "saveState", "newButton", "openButton", "saveButton", "saveAsButton", "copyLatexButton", "insertImageButton", "showHiddenButton", "fileInput", "imageInput",
  "pageSelect", "addPageButton", "renamePageButton", "deletePageButton",
  "undoButton", "redoButton", "constructionMenu", "measurementMenu", "transformMenu", "dataMenu", "displayMenu", "deleteButton", "resetViewButton", "snapToggle", "toolHint",
  "statusTool", "statusSelection", "statusCoordinates", "statusCount",
  "inspectorTitle", "selectionBadge", "pointSize", "pointSizeValue", "pointColor", "pointColorValue",
  "pointName", "showLabels", "showLabelsText", "lineWidth", "lineWidthValue", "lineColor", "lineColorValue", "lineDash",
  "angleMarkSizeRow", "angleMarkSize", "angleMarkSizeValue", "applyStyleButton", "gridSize",
  "pathMarkKindRow", "pathMarkKind",
  "angleMarkOpacityRow", "angleMarkOpacity", "angleMarkOpacityValue", "angleMarkDirectionRow", "angleMarkShowDirection", "angleMarkReverse", "batchRenameButton",
  "inputDialog", "inputDialogForm", "inputDialogTitle", "inputDialogMessage", "inputDialogValue", "inputDialogCancel", "inputDialogConfirm",
].map((id) => [id, document.getElementById(id)]));
const appShell = document.querySelector(".app-shell");

let settings = loadSettings();
let loadedProject = loadAutosaveProject();
let projectPages = loadedProject.pages;
let activePageIndex = loadedProject.activePageIndex;
let documentModel = GeometryDocument.fromJSON(projectPages[activePageIndex].document);
let history = new DocumentHistory();
let currentTool = "select";
let selectedId = null;
let selectedIds = new Set();
let pendingId = null;
let constructionPointIds = [];
let constructionStartSnapshot = null;
let dragState = null;
let panState = null;
let spacePanActive = false;
const activeTouchPoints = new Map();
const ignoredTouchPointers = new Set();
const ignoredNonTouchPointers = new Set();
const touchEndInProgress = new Set();
let touchIntent = null;
let touchGesture = null;
let touchDrainActive = false;
let nonTouchPointerId = null;
let interactionEpoch = 0;
let marqueeState = null;
let markerState = null;
let doodleState = null;
let pendingRenderFrame = null;
let pathMarkDragState = null;
let constructionDragState = null;
let styleEditSnapshot = null;
let pointNameEditSnapshot = null;
let pointNameEditPointId = null;
let pointNameEditOriginalLabel = "";
let angleMarkSizeEditSnapshot = null;
let pointerWorld = { x: 0, y: 0 };
let view = { x: 0, y: 0, width: 1200, height: 720 };
let canvasAspect = null;
let canvasPixelWidth = null;
let canvasLayoutOrientation = null;
let toastTimer = null;
let infoTimer = null;
const traceHistory = new Map();
const animationTimers = new Map();
let dialogResolver = null;
let dialogPreviousFocus = null;
let objectClipboard = null;
let pasteCount = 0;
let lastTransform = null;
let customTools = loadCustomTools();
let currentProjectHandle;
const projectHandleRestorePromise = restoreProjectHandle().then((handle) => {
  if (currentProjectHandle === undefined) currentProjectHandle = handle;
});

function finishDialog(value) {
  if (!dialogResolver) return;
  const resolve = dialogResolver;
  dialogResolver = null;
  elements.inputDialog.hidden = true;
  appShell?.removeAttribute("inert");
  const previousFocus = dialogPreviousFocus;
  dialogPreviousFocus = null;
  if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
  resolve(value);
}

function askUser(message, defaultValue = "", options = {}) {
  if (dialogResolver) finishDialog(null);
  dialogPreviousFocus = document.activeElement;
  elements.inputDialogTitle.textContent = options.title || "请输入";
  elements.inputDialogMessage.textContent = message;
  elements.inputDialogValue.value = String(defaultValue ?? "");
  elements.inputDialogValue.hidden = options.confirmOnly === true;
  elements.inputDialogValue.rows = Number(options.rows) || (options.multiline ? 5 : 2);
  elements.inputDialogConfirm.textContent = options.confirmLabel || "确定";
  elements.inputDialogCancel.textContent = options.cancelLabel || "取消";
  appShell?.setAttribute("inert", "");
  elements.inputDialog.hidden = false;
  if (!options.confirmOnly) setTimeout(() => { elements.inputDialogValue.focus(); elements.inputDialogValue.select(); }, 0);
  else setTimeout(() => elements.inputDialogConfirm.focus(), 0);
  return new Promise((resolve) => { dialogResolver = resolve; });
}

function confirmUser(message, options = {}) {
  return askUser(message, "", { ...options, title: options.title || "请确认", confirmOnly: true });
}

function loadSettings() {
  return loadPreferences();
}

function loadCustomTools() {
  try {
    const tools = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_KEY) || "[]");
    return Array.isArray(tools) ? tools.filter((tool) => tool?.name && tool?.document && Array.isArray(tool.ids)) : [];
  } catch { return []; }
}

function saveCustomTools() {
  localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(customTools));
}

function loadAutosaveProject() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) {
      const document = new GeometryDocument();
      return { activePageIndex: 0, pages: [{ name: "页面 1", document: document.toJSON() }] };
    }
    const parsed = JSON.parse(saved);
    if (parsed.projectVersion === 1 && Array.isArray(parsed.pages) && parsed.pages.length) {
      const pages = parsed.pages.map((page, index) => ({
        name: String(page.name || `页面 ${index + 1}`),
        document: GeometryDocument.fromJSON(page.document).toJSON(),
      }));
      return { activePageIndex: Math.max(0, Math.min(pages.length - 1, Number(parsed.activePageIndex) || 0)), pages };
    }
    const document = GeometryDocument.fromJSON(parsed);
    return { activePageIndex: 0, pages: [{ name: "页面 1", document: document.toJSON() }] };
  } catch {
    const document = new GeometryDocument();
    return { activePageIndex: 0, pages: [{ name: "页面 1", document: document.toJSON() }] };
  }
}

function saveSettings() {
  settings = savePreferences(settings);
  syncSettingsControls();
}

function autosave() {
  projectPages[activePageIndex].document = documentModel.toJSON();
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      projectVersion: 1, activePageIndex, pages: projectPages,
    }));
    elements.saveState.textContent = "已自动保存";
    elements.saveState.title = "画板内容已自动保存到本浏览器";
    elements.saveState.classList.remove("error");
    return true;
  } catch (error) {
    console.warn("浏览器自动保存空间不足，请保存为 .spn 工程。", error);
    elements.saveState.textContent = "自动保存空间不足";
    elements.saveState.title = "浏览器本地空间不足；请使用“保存”将工程写入 .spn 文件";
    elements.saveState.classList.add("error");
    return false;
  }
}

function syncPageControls() {
  const signature = projectPages.map((page) => page.name).join("\u0000");
  if (elements.pageSelect.dataset.signature !== signature) {
    elements.pageSelect.replaceChildren(...projectPages.map((page, index) => {
      const option = document.createElement("option");
      option.value = String(index); option.textContent = page.name;
      return option;
    }));
    elements.pageSelect.dataset.signature = signature;
  }
  elements.pageSelect.value = String(activePageIndex);
  elements.deletePageButton.disabled = projectPages.length <= 1;
}

function stopAllAnimations() {
  for (const timer of animationTimers.values()) clearInterval(timer);
  animationTimers.clear();
}

function loadPage(index) {
  if (index < 0 || index >= projectPages.length || index === activePageIndex) return;
  cancelIncompleteConstruction();
  interactionEpoch += 1;
  projectPages[activePageIndex].document = documentModel.toJSON();
  activePageIndex = index;
  documentModel = GeometryDocument.fromJSON(projectPages[index].document);
  history.clear(); clearSelection(); pendingId = null; constructionPointIds = []; constructionStartSnapshot = null;
  traceHistory.clear(); stopAllAnimations(); resetView(); autosave(); render();
}

function isSelected(id) {
  return selectedIds.has(id);
}

function clearSelection() {
  selectedIds = new Set();
  selectedId = null;
}

function selectOnly(id) {
  selectedIds = id ? new Set([id]) : new Set();
  selectedId = id || null;
}

function setSelection(ids, primaryId = null) {
  selectedIds = new Set(ids.filter((id) => documentModel.getObject(id)));
  selectedId = primaryId && selectedIds.has(primaryId) ? primaryId : [...selectedIds].at(-1) || null;
}

function selectedObjects() {
  return [...selectedIds].map((id) => documentModel.getObject(id)).filter(Boolean);
}

function mutate(action) {
  const snapshot = documentModel.serialize();
  action();
  if (snapshot !== documentModel.serialize()) history.recordSnapshot(snapshot);
  afterDocumentChange();
}

function cancelIncompleteConstruction() {
  const activeStates = [constructionDragState, markerState, doodleState, pathMarkDragState, dragState, panState, marqueeState];
  const hasTouchInteraction = Boolean(touchIntent || touchGesture || touchDrainActive || activeTouchPoints.size);
  const hasPointerSession = hasTouchInteraction || nonTouchPointerId !== null || ignoredNonTouchPointers.size;
  const hasActiveStep = Boolean(
    constructionStartSnapshot || pendingId || constructionPointIds.length || activeStates.some(Boolean) || hasPointerSession,
  );
  if (!hasActiveStep) return false;
  const snapshot = constructionStartSnapshot || pathMarkDragState?.snapshot || dragState?.snapshot;
  const dragSelectionBefore = Array.isArray(dragState?.selectionBefore) ? dragState.selectionBefore : null;
  const restoredSelection = marqueeState
    ? [...marqueeState.baseSelection]
    : dragSelectionBefore
      ? [...dragSelectionBefore]
      : panState || touchGesture || touchIntent ? [...selectedIds] : [];
  const restoredPrimary = dragSelectionBefore ? dragState.primaryBefore : null;
  if (snapshot) documentModel = GeometryDocument.fromJSON(snapshot);
  const capturedPointerIds = new Set([
    ...activeStates.map((state) => state?.pointerId).filter((id) => id != null),
    ...activeTouchPoints.keys(),
    ...ignoredNonTouchPointers,
  ]);
  interactionEpoch += 1;
  activeTouchPoints.clear();
  ignoredTouchPointers.clear();
  ignoredNonTouchPointers.clear();
  touchIntent = null;
  touchGesture = null;
  touchDrainActive = false;
  nonTouchPointerId = null;
  constructionStartSnapshot = null;
  pendingId = null;
  constructionPointIds = [];
  constructionDragState = null;
  markerState = null;
  doodleState = null;
  pathMarkDragState = null;
  dragState = null;
  panState = null;
  marqueeState = null;
  elements.geometryCanvas.classList.remove("panning");
  for (const pointerId of capturedPointerIds) {
    try { elements.geometryCanvas.releasePointerCapture(pointerId); } catch {}
  }
  setSelection(restoredSelection, restoredPrimary);
  return true;
}

function afterDocumentChange() {
  setSelection([...selectedIds], selectedId);
  if (pendingId && !documentModel.getObject(pendingId)) pendingId = null;
  constructionPointIds = constructionPointIds.filter((id) => documentModel.isPoint(id));
  for (const [id, timer] of animationTimers) if (!documentModel.getObject(id)) {
    clearInterval(timer); animationTimers.delete(id);
  }
  documentModel.title = elements.documentTitle.value.trim() || "未命名画板";
  autosave();
  render();
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function appendFormattedText(element, value, options = {}) {
  const segments = parseMathText(value, options);
  for (const segment of segments) {
    const attributes = segment.script === "normal" ? {} : {
      "baseline-shift": segment.script,
      "font-size": "70%",
    };
    const span = createSvgElement("tspan", attributes);
    span.textContent = segment.text;
    element.append(span);
  }
  if (!segments.length) element.textContent = " ";
}

function clearLayer(layer) {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
}

function renderSnapGrid() {
  clearLayer(elements.snapGridLayer);
  if (!settings.snapToGrid) return;
  const baseSpacing = Math.max(5, Number(settings.gridSize) || 20);
  const rect = elements.geometryCanvas.getBoundingClientRect();
  const pixelsPerWorldUnit = rect.width > 0 ? rect.width / view.width : 1;
  let spacing = baseSpacing;
  while (spacing * pixelsPerWorldUnit < 12) spacing *= 2;
  const startX = Math.ceil(view.x / spacing) * spacing;
  const endX = view.x + view.width;
  const startY = Math.ceil(view.y / spacing) * spacing;
  const endY = view.y + view.height;
  const fragment = document.createDocumentFragment();
  const isMajor = (value) => Math.abs(Math.round(value / baseSpacing)) % 5 === 0;
  for (let x = startX; x <= endX + spacing * 0.01; x += spacing) {
    fragment.append(createSvgElement("line", {
      x1: x,
      y1: view.y,
      x2: x,
      y2: endY,
      class: `snap-grid-line${isMajor(x) ? " major" : ""}`,
    }));
  }
  for (let y = startY; y <= endY + spacing * 0.01; y += spacing) {
    fragment.append(createSvgElement("line", {
      x1: view.x,
      y1: y,
      x2: endX,
      y2: y,
      class: `snap-grid-line${isMajor(y) ? " major" : ""}`,
    }));
  }
  elements.snapGridLayer.append(fragment);
}

function scheduleRender() {
  if (pendingRenderFrame !== null) return;
  pendingRenderFrame = requestAnimationFrame(() => {
    pendingRenderFrame = null;
    render();
  });
}

function shapeAttributes(object, extraClass = "") {
  const classes = ["geometry-shape", extraClass];
  if (object.locked) classes.push("locked-object");
  if (isSelected(object.id)) classes.push("selected-visible");
  if (object.id === documentModel.markedMirrorId) classes.push("marked-mirror");
  if (object.id === pendingId || constructionPointIds.includes(object.id)) classes.push("pending-visible");
  return {
    class: classes.filter(Boolean).join(" "),
    stroke: object.style?.color || settings.lineColor,
    "stroke-width": object.style?.width || settings.lineWidth,
    "stroke-dasharray": object.style?.dash === "dashed" ? "8 6" : "none",
    "data-object-id": object.id,
  };
}

function renderShape(object, layer = elements.objectLayer) {
  const geometry = documentModel.getShapeGeometry(object);
  if (!geometry) return;
  if (geometry.kind === "coordinateSystem") {
    const group = createSvgElement("g", { "data-object-id": object.id, class: isSelected(object.id) ? "selected-coordinate-system" : "" });
    const gridGroup = createSvgElement("g", { class: "coordinate-grid" });
    const axisGroup = createSvgElement("g", { class: "coordinate-axes" });
    const left = view.x;
    const right = view.x + view.width;
    const top = view.y;
    const bottom = view.y + view.height;
    if (geometry.showGrid) {
      if (geometry.gridType === "polar") {
        const maximumRadius = Math.hypot(
          Math.max(Math.abs(left - geometry.origin.x), Math.abs(right - geometry.origin.x)),
          Math.max(Math.abs(top - geometry.origin.y), Math.abs(bottom - geometry.origin.y)),
        );
        const circleCount = Math.min(120, Math.ceil(maximumRadius / geometry.unitX));
        for (let index = 1; index <= circleCount; index += 1) {
          gridGroup.append(createSvgElement("circle", {
            cx: geometry.origin.x, cy: geometry.origin.y, r: index * geometry.unitX,
          }));
        }
        for (let index = 0; index < 24; index += 1) {
          const angle = index * Math.PI / 12;
          gridGroup.append(createSvgElement("line", {
            x1: geometry.origin.x - Math.cos(angle) * maximumRadius,
            y1: geometry.origin.y - Math.sin(angle) * maximumRadius,
            x2: geometry.origin.x + Math.cos(angle) * maximumRadius,
            y2: geometry.origin.y + Math.sin(angle) * maximumRadius,
          }));
        }
      } else {
        const startX = Math.floor((left - geometry.origin.x) / geometry.unitX);
        const endX = Math.ceil((right - geometry.origin.x) / geometry.unitX);
        const startY = Math.floor((top - geometry.origin.y) / geometry.unitY);
        const endY = Math.ceil((bottom - geometry.origin.y) / geometry.unitY);
        for (let index = startX; index <= endX && index - startX < 240; index += 1) {
          const x = geometry.origin.x + index * geometry.unitX;
          gridGroup.append(createSvgElement("line", { x1: x, y1: top, x2: x, y2: bottom }));
        }
        for (let index = startY; index <= endY && index - startY < 240; index += 1) {
          const y = geometry.origin.y + index * geometry.unitY;
          gridGroup.append(createSvgElement("line", { x1: left, y1: y, x2: right, y2: y }));
        }
      }
    }
    axisGroup.append(
      createSvgElement("line", { x1: left, y1: geometry.origin.y, x2: right, y2: geometry.origin.y }),
      createSvgElement("line", { x1: geometry.origin.x, y1: top, x2: geometry.origin.x, y2: bottom }),
    );
    const originHit = createSvgElement("circle", {
      cx: geometry.origin.x, cy: geometry.origin.y, r: 12,
      class: "hit-target", "data-object-id": object.id,
    });
    group.append(gridGroup, axisGroup, originHit);
    layer.append(group);
    return;
  }
  if (geometry.kind === "plot") {
    for (const points of geometry.paths) {
      const pathData = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
      layer.append(
        createSvgElement("path", { d: pathData, class: "geometry-shape hit-target", "data-object-id": object.id }),
        createSvgElement("path", { d: pathData, fill: "none", ...shapeAttributes(object, "function-plot") }),
      );
    }
    return;
  }
  let visible;
  let hit;
  if (geometry.kind === "pathMark") {
    const paths = [];
    for (let index = 0; index < geometry.strokeCount; index += 1) {
      const offset = (index - (geometry.strokeCount - 1) / 2) * (geometry.markKind === "arrow" ? 11 : 5);
      const center = {
        x: geometry.center.x + geometry.direction.x * offset,
        y: geometry.center.y + geometry.direction.y * offset,
      };
      if (geometry.markKind === "arrow") {
        const apex = { x: center.x + geometry.direction.x * 5, y: center.y + geometry.direction.y * 5 };
        const back = { x: center.x - geometry.direction.x * 5, y: center.y - geometry.direction.y * 5 };
        paths.push(
          `M ${back.x + geometry.normal.x * 5} ${back.y + geometry.normal.y * 5} L ${apex.x} ${apex.y}`,
          `M ${back.x - geometry.normal.x * 5} ${back.y - geometry.normal.y * 5} L ${apex.x} ${apex.y}`,
        );
      } else {
        paths.push(`M ${center.x - geometry.normal.x * 7} ${center.y - geometry.normal.y * 7} L ${center.x + geometry.normal.x * 7} ${center.y + geometry.normal.y * 7}`);
      }
    }
    const attributes = {
      d: paths.join(" "),
      fill: "none",
      "data-mark-kind": geometry.markKind,
      "data-mark-strokes": geometry.strokeCount,
    };
    hit = createSvgElement("path", { ...attributes, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("path", { ...attributes, ...shapeAttributes(object) });
  } else if (geometry.kind === "doodle") {
    const points = geometry.points.map((point) => `${point.x},${point.y}`).join(" ");
    hit = createSvgElement("polyline", { points, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("polyline", { points, ...shapeAttributes(object) });
  } else if (geometry.kind === "arc") {
    const attributes = {
      d: `M ${geometry.start.x} ${geometry.start.y} A ${geometry.radius} ${geometry.radius} 0 ${Math.abs(geometry.signedAngle) > Math.PI ? 1 : 0} ${geometry.signedAngle >= 0 ? 1 : 0} ${geometry.end.x} ${geometry.end.y}`,
      fill: "none",
    };
    hit = createSvgElement("path", { ...attributes, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("path", { ...attributes, ...shapeAttributes(object) });
  } else if (geometry.kind === "circleInterior") {
    const attributes = { cx: geometry.center.x, cy: geometry.center.y, r: geometry.radius };
    hit = createSvgElement("circle", { ...attributes, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("circle", {
      ...attributes, ...shapeAttributes(object),
      style: `fill: ${object.style?.color || settings.lineColor}; fill-opacity: ${geometry.opacity}`,
    });
  } else if (geometry.kind === "arcInterior") {
    const arcCommand = `A ${geometry.radius} ${geometry.radius} 0 ${Math.abs(geometry.signedAngle) > Math.PI ? 1 : 0} ${geometry.signedAngle >= 0 ? 1 : 0} ${geometry.end.x} ${geometry.end.y}`;
    const pathData = geometry.interiorKind === "sector"
      ? `M ${geometry.center.x} ${geometry.center.y} L ${geometry.start.x} ${geometry.start.y} ${arcCommand} Z`
      : `M ${geometry.start.x} ${geometry.start.y} ${arcCommand} Z`;
    hit = createSvgElement("path", { d: pathData, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("path", {
      d: pathData, ...shapeAttributes(object),
      style: `fill: ${object.style?.color || settings.lineColor}; fill-opacity: ${geometry.opacity}`,
    });
  } else if (geometry.kind === "angleMark") {
    const outlineData = geometry.rightAngle
      ? `M ${geometry.start.x} ${geometry.start.y} L ${geometry.corner.x} ${geometry.corner.y} L ${geometry.end.x} ${geometry.end.y}`
      : Array.from({ length: geometry.strokeCount }, (_, index) => {
        const spacing = geometry.strokeCount > 1
          ? Math.min(5, Math.max(2, (geometry.radius - 6) / (geometry.strokeCount - 1)))
          : 0;
        const radius = Math.max(6, geometry.radius - index * spacing);
        const start = {
          x: geometry.vertex.x + (geometry.start.x - geometry.vertex.x) / geometry.radius * radius,
          y: geometry.vertex.y + (geometry.start.y - geometry.vertex.y) / geometry.radius * radius,
        };
        const end = {
          x: geometry.vertex.x + (geometry.end.x - geometry.vertex.x) / geometry.radius * radius,
          y: geometry.vertex.y + (geometry.end.y - geometry.vertex.y) / geometry.radius * radius,
        };
        return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${geometry.signedAngle > Math.PI ? 1 : 0} 1 ${end.x} ${end.y}`;
      }).join(" ");
    const fillData = geometry.rightAngle
      ? `M ${geometry.vertex.x} ${geometry.vertex.y} L ${geometry.start.x} ${geometry.start.y} L ${geometry.corner.x} ${geometry.corner.y} L ${geometry.end.x} ${geometry.end.y} Z`
      : `M ${geometry.vertex.x} ${geometry.vertex.y} L ${geometry.start.x} ${geometry.start.y} A ${geometry.radius} ${geometry.radius} 0 ${geometry.signedAngle > Math.PI ? 1 : 0} 1 ${geometry.end.x} ${geometry.end.y} Z`;
    const angleKind = geometry.rightAngle ? "right" : "arc";
    const fill = createSvgElement("path", {
      d: fillData,
      class: `angle-mark-fill${isSelected(object.id) ? " selected-visible" : ""}`,
      fill: object.style?.color || settings.lineColor,
      "fill-opacity": geometry.opacity,
      "data-object-id": object.id,
      "data-angle-kind": angleKind,
    });
    hit = createSvgElement("path", { d: fillData, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("path", {
      d: outlineData,
      fill: "none",
      "data-angle-kind": angleKind,
      "data-angle-strokes": geometry.strokeCount,
      ...shapeAttributes(object),
    });
    layer.append(hit, fill, visible);
    if (geometry.showDirection && !geometry.rightAngle) {
      const angle = geometry.startAngle + geometry.signedAngle / 2;
      const point = {
        x: geometry.vertex.x + Math.cos(angle) * geometry.radius,
        y: geometry.vertex.y + Math.sin(angle) * geometry.radius,
      };
      const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
      const normal = { x: Math.cos(angle), y: Math.sin(angle) };
      const arrow = createSvgElement("path", {
        d: `M ${point.x - tangent.x * 7 + normal.x * 4} ${point.y - tangent.y * 7 + normal.y * 4} L ${point.x} ${point.y} L ${point.x - tangent.x * 7 - normal.x * 4} ${point.y - tangent.y * 7 - normal.y * 4}`,
        fill: "none", ...shapeAttributes(object, "angle-direction-arrow"),
      });
      layer.append(arrow);
    }
    return;
  } else if (geometry.kind === "circle") {
    const attributes = { cx: geometry.center.x, cy: geometry.center.y, r: geometry.radius };
    hit = createSvgElement("circle", { ...attributes, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("circle", { ...attributes, ...shapeAttributes(object) });
  } else {
    let endpoints;
    if (geometry.segment) {
      endpoints = { x1: geometry.a.x, y1: geometry.a.y, x2: geometry.b.x, y2: geometry.b.y };
    } else {
      const clipped = clipLineGeometryToView(geometry, view);
      if (!clipped) return;
      endpoints = {
        x1: clipped.a.x,
        y1: clipped.a.y,
        x2: clipped.b.x,
        y2: clipped.b.y,
      };
    }
    hit = createSvgElement("line", { ...endpoints, class: "geometry-shape hit-target", "data-object-id": object.id });
    visible = createSvgElement("line", { ...endpoints, ...shapeAttributes(object) });
  }
  layer.append(hit, visible);
}

function renderPoint(object, layer = elements.objectLayer) {
  const position = documentModel.getPointPosition(object);
  if (!position) return;
  const classes = ["geometry-point"];
  if (object.definition.kind !== "free") classes.push("derived");
  if (object.locked) classes.push("locked-object");
  else if (documentModel.isPointDirectlyMovable(object)) classes.push("directly-movable");
  else if (documentModel.canTranslateObjects([object.id])) classes.push("dependency-movable");
  else classes.push("fixed-point");
  if (isSelected(object.id)) classes.push("selected-visible");
  if (object.id === documentModel.markedCenterId) classes.push("marked-center");
  if (object.id === pendingId || constructionPointIds.includes(object.id)) classes.push("pending-visible");
  const point = createSvgElement("circle", {
    cx: position.x,
    cy: position.y,
    r: object.style?.radius || settings.pointSize,
    fill: object.style?.color || settings.pointColor,
    class: classes.join(" "),
    "data-object-id": object.id,
  });
  layer.append(point);
  if (object.style?.showLabel !== false) {
    const offset = object.labelOffset || {
      x: (object.style?.radius || settings.pointSize) + 6,
      y: -(object.style?.radius || settings.pointSize) - 4,
    };
    const label = createSvgElement("text", {
      x: position.x + offset.x,
      y: position.y + offset.y,
      class: "point-label",
      "font-size": Number(object.style?.labelFontSize) || Number(settings.pointLabelFontSize) || 17,
      "data-label-for": object.id,
    });
    appendFormattedText(label, object.label, { legacyBracketSubscript: true });
    layer.append(label);
  }
}

function renderText(object, layer = elements.objectLayer) {
  const text = createSvgElement("text", {
    x: object.x,
    y: object.y,
    class: `standalone-text${isSelected(object.id) ? " selected-visible" : ""}${object.locked ? " locked-object" : ""}`,
    fill: object.style?.color || settings.lineColor,
    "font-size": object.style?.fontSize || 18,
    "data-object-id": object.id,
  });
  const table = object.type === "table" ? documentModel.getTableData(object) : null;
  const content = object.type === "measurement"
    ? documentModel.getMeasurementText(object, settings.measurementDecimals) || "无效度量"
    : ["parameter", "calculation"].includes(object.type) ? documentModel.getValueText(object) || "无效数值"
      : table ? [table.headers.join("    "), ...table.rows.map((row) => row.join("    "))].join("\n")
        : object.type === "actionButton" ? object.label : object.content;
  if (object.type === "actionButton") {
    const fontSize = object.style?.fontSize || 15;
    const width = Math.max(72, String(content).length * fontSize * 0.9 + 24);
    layer.append(createSvgElement("rect", {
      x: object.x - 12, y: object.y - fontSize - 8, width, height: fontSize + 18, rx: 8,
      class: `action-button-background${isSelected(object.id) ? " selected-visible" : ""}`,
      "data-object-id": object.id,
    }));
  }
  const lines = String(content).split(/\r?\n/);
  lines.forEach((line, index) => {
    const tspan = createSvgElement("tspan", { x: object.x, dy: index === 0 ? 0 : "1.35em" });
    appendFormattedText(tspan, line || " ", { enableScripts: true });
    text.append(tspan);
  });
  layer.append(text);
}

function renderImage(object, layer = elements.objectLayer) {
  const image = createSvgElement("image", {
    href: object.dataUrl, x: object.x, y: object.y, width: object.width, height: object.height,
    opacity: object.opacity ?? 1, class: `canvas-image${isSelected(object.id) ? " selected-visible" : ""}`,
    "data-object-id": object.id,
  });
  layer.append(image);
  if (isSelected(object.id)) layer.append(createSvgElement("rect", {
    x: object.x, y: object.y, width: object.width, height: object.height,
    class: "image-selection-outline", "pointer-events": "none",
  }));
}

function renderTraces() {
  clearLayer(elements.traceLayer);
  for (const object of documentModel.objects) {
    if (object.type !== "point" || !object.trace || object.hidden) continue;
    const position = documentModel.getPointPosition(object);
    if (!position) continue;
    const points = traceHistory.get(object.id) || [];
    const previous = points.at(-1);
    if (!previous || Math.hypot(position.x - previous.x, position.y - previous.y) >= Math.max(0.8, view.width / 1600)) {
      points.push({ ...position, color: object.style?.color || settings.pointColor });
      if (points.length > 2500) points.splice(0, points.length - 2500);
      traceHistory.set(object.id, points);
    }
  }
  for (const points of traceHistory.values()) for (const point of points) {
    elements.traceLayer.append(createSvgElement("circle", {
      cx: point.x, cy: point.y, r: Math.max(1.2, view.width / 1600), fill: point.color,
      class: "trace-dot", "pointer-events": "none",
    }));
  }
}

function renderPreview() {
  clearLayer(elements.previewLayer);
  if (doodleState) {
    elements.previewLayer.append(createSvgElement("polyline", {
      points: doodleState.points.map((point) => `${point.x},${point.y}`).join(" "),
      class: "marker-doodle-preview", "pointer-events": "none",
    }));
    return;
  }
  if (marqueeState) {
    const x = Math.min(marqueeState.start.x, marqueeState.current.x);
    const y = Math.min(marqueeState.start.y, marqueeState.current.y);
    const width = Math.abs(marqueeState.current.x - marqueeState.start.x);
    const height = Math.abs(marqueeState.current.y - marqueeState.start.y);
    elements.previewLayer.append(createSvgElement("rect", {
      x, y, width, height, class: "selection-marquee", "pointer-events": "none",
    }));
    return;
  }
  if (markerState) {
    const vertex = documentModel.getPointPosition(markerState.vertexId);
    if (!vertex) return;
    elements.previewLayer.append(createSvgElement("line", {
      x1: vertex.x, y1: vertex.y, x2: markerState.current.x, y2: markerState.current.y,
      class: "marker-drag-preview", "pointer-events": "none",
    }));
    return;
  }
  if (!pendingId || !["segment", "line", "ray", "circle"].includes(currentTool)) return;
  const first = documentModel.getPointPosition(pendingId);
  if (!first) return;
  if (currentTool === "circle") {
    const radius = Math.hypot(pointerWorld.x - first.x, pointerWorld.y - first.y);
    elements.previewLayer.append(createSvgElement("circle", {
      cx: first.x, cy: first.y, r: radius, fill: "none", stroke: "#ff9f1c", "stroke-width": 1.5,
      "stroke-dasharray": "6 5", "pointer-events": "none",
    }));
  } else {
    let endpoints = { x1: first.x, y1: first.y, x2: pointerWorld.x, y2: pointerWorld.y };
    if (currentTool === "line") {
      const dx = pointerWorld.x - first.x;
      const dy = pointerWorld.y - first.y;
      endpoints = { x1: first.x - dx * 1000, y1: first.y - dy * 1000, x2: first.x + dx * 1000, y2: first.y + dy * 1000 };
    } else if (currentTool === "ray") {
      const dx = pointerWorld.x - first.x;
      const dy = pointerWorld.y - first.y;
      endpoints = { x1: first.x, y1: first.y, x2: first.x + dx * 1000, y2: first.y + dy * 1000 };
    }
    elements.previewLayer.append(createSvgElement("line", {
      ...endpoints, stroke: "#ff9f1c", "stroke-width": 1.5, "stroke-dasharray": "6 5", "pointer-events": "none",
    }));
  }
}

function render() {
  if (pendingRenderFrame !== null) {
    cancelAnimationFrame(pendingRenderFrame);
    pendingRenderFrame = null;
  }
  renderSnapGrid();
  renderTraces();
  clearLayer(elements.objectLayer);
  for (const object of documentModel.objectsInPaintOrder()) {
    if (object.hidden) continue;
    const group = createSvgElement("g", { "data-paint-object-id": object.id });
    elements.objectLayer.append(group);
    if (object.type === "image") renderImage(object, group);
    else if (object.type === "point") renderPoint(object, group);
    else if (["text", "measurement", "parameter", "calculation", "table", "actionButton"].includes(object.type)) renderText(object, group);
    else renderShape(object, group);
  }
  renderPreview();
  updateViewBox();
  updateUiState();
}

function updateViewBox() {
  elements.geometryCanvas.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function updateUiState() {
  syncPageControls();
  elements.emptyState.classList.toggle("hidden", documentModel.objects.length > 0);
  elements.undoButton.disabled = !history.canUndo && !constructionStartSnapshot;
  elements.redoButton.disabled = !history.canRedo;
  elements.deleteButton.disabled = selectedIds.size === 0;
  elements.applyStyleButton.disabled = selectedIds.size === 0;
  elements.batchRenameButton.disabled = selectedObjects().filter((object) => object.type === "point").length < 2;
  elements.showHiddenButton.hidden = !documentModel.objects.some((object) => object.hidden);
  elements.statusTool.textContent = `${toolName(currentTool)}工具`;
  const selected = selectedId ? documentModel.getObject(selectedId) : null;
  const selection = selectedObjects();
  elements.statusSelection.textContent = selection.length > 1
    ? `已选择 ${selection.length} 个对象`
    : selected ? `已选择：${objectDescription(selected)}` : "未选择对象";
  elements.statusCount.textContent = `${documentModel.objects.length} 个对象`;
  elements.inspectorTitle.textContent = selection.length > 1
    ? `${selection.length} 个对象`
    : selected ? objectDescription(selected) : "新建对象默认值";
  elements.selectionBadge.textContent = selection.length ? "已选择" : "全局";
  elements.toolHint.textContent = interactionHint();
  syncInspectorControls(selection);
}

function toolName(tool) {
  return {
    select: "选择", point: "点", segment: "线段", line: "直线", ray: "射线", midpoint: "中点",
    perpendicularBisector: "中垂线", parallel: "平行线", perpendicular: "垂线",
    angleBisector: "角平分线", marker: "标识笔", info: "信息", text: "文本", circle: "圆", threePointCircle: "过三点圆",
  }[tool];
}

function objectDescription(object) {
  if (object.type === "point") return `点 ${object.label}`;
  if (object.type === "text") return `文本“${object.content.slice(0, 12)}”`;
  if (object.type === "measurement") {
    return documentModel.getMeasurementText(object, settings.measurementDecimals) || "度量值";
  }
  if (object.type === "parameter") return `参数 ${object.name}`;
  if (object.type === "calculation") return `计算 ${object.name}`;
  if (object.type === "table") return "数据表格";
  if (object.type === "actionButton") return `动作按钮“${object.label}”`;
  if (object.type === "image") return "图片";
  return {
    segment: "线段", line: "直线", ray: "射线", parallelLine: "平行线",
    perpendicularLine: "垂线", perpendicularBisector: "中垂线",
    angleBisector: "角平分线", angleMark: "角标记", pathMark: "路径标识", doodle: "手绘标识",
    arc: "圆弧", threePointArc: "圆弧", circleInterior: "圆内部", sectorInterior: "扇形内部", segmentInterior: "弓形内部",
    coordinateSystem: "坐标系", functionGraph: "函数图像", parametricPlot: "参数曲线", locus: "轨迹", transformedShape: "变换像",
    circle: "圆", radiusCircle: "圆", threePointCircle: "过三点圆", incircle: "三角形内切圆",
  }[object.type] || "对象";
}

function interactionHint() {
  const pendingPoint = pendingId ? documentModel.getObject(pendingId) : null;
  const pendingName = pendingPoint?.type === "point" ? `点 ${pendingPoint.label}` : "第一个对象";
  if (["segment", "line", "ray", "circle"].includes(currentTool) && pendingId) {
    const target = currentTool === "circle" ? "圆上一点或一条半径线段" : "第二个点";
    const shiftHint = currentTool === "circle" ? "" : "；按住 Shift 约束 15° 方向";
    return `已选 ${pendingName}；请选择${target}${shiftHint}；Esc 取消本步`;
  }
  if (["midpoint", "perpendicularBisector"].includes(currentTool) && pendingId) {
    return `已选 ${pendingName}；请选择另一个点；Esc 取消本步`;
  }
  if (["parallel", "perpendicular"].includes(currentTool) && pendingId) {
    return `直线将经过 ${pendingName}；请选择基准线；Esc 取消本步`;
  }
  if (["angleBisector", "threePointCircle"].includes(currentTool) && constructionPointIds.length) {
    const names = constructionPointIds.map((id) => documentModel.getObject(id)?.label).filter(Boolean).join(" → ");
    const remaining = 3 - constructionPointIds.length;
    return `已按顺序选择 ${names}；还需 ${remaining} 个点；Esc 取消本步`;
  }
  return toolDescriptions[currentTool];
}

function setTool(tool) {
  const restored = cancelIncompleteConstruction();
  currentTool = tool;
  pendingId = null;
  constructionPointIds = [];
  markerState = null;
  doodleState = null;
  pathMarkDragState = null;
  constructionDragState = null;
  if (tool !== "info") elements.infoPanel.hidden = true;
  document.querySelectorAll(".tool-button[data-tool]").forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.geometryCanvas.className.baseVal = `tool-${tool}`;
  if (restored) autosave();
  render();
}

function activateTool(tool) {
  const restored = cancelIncompleteConstruction();
  if (restored) afterDocumentChange();
  if (["parallel", "perpendicular"].includes(tool) && constructDerivedLinesFromSelection(tool)) return;
  if (tool === "perpendicularBisector" && constructPerpendicularBisectorsFromSelection()) return;
  if (tool === "angleBisector" && constructAngleBisectorFromSelection()) return;
  setTool(tool);
}

function clientToWorld(event, snapToGrid = false) {
  let world = clientPointToWorld(
    view,
    elements.geometryCanvas.getBoundingClientRect(),
    { x: event.clientX, y: event.clientY },
  );
  if (snapToGrid && settings.snapToGrid && !event.altKey) {
    const size = Number(settings.gridSize) || 20;
    world = { x: Math.round(world.x / size) * size, y: Math.round(world.y / size) * size };
  }
  return world;
}

function captureCanvasPointer(pointerId) {
  try {
    if (!elements.geometryCanvas.hasPointerCapture(pointerId)) elements.geometryCanvas.setPointerCapture(pointerId);
  } catch {}
}

function selectionTolerance() {
  const rect = elements.geometryCanvas.getBoundingClientRect();
  const cssPixels = document.documentElement.dataset.input === "coarse" ? 18 : 10;
  return cssPixels * view.width / Math.max(1, rect.width);
}

function constrainConstructionPosition(position, event) {
  if (!event.shiftKey || !pendingId || !["segment", "line", "ray"].includes(currentTool)) return position;
  const pointHit = documentModel.hitTestPoint(position, selectionTolerance());
  if (pointHit) return position;
  const anchor = documentModel.getPointPosition(pendingId);
  if (!anchor) return position;
  const dx = position.x - anchor.x;
  const dy = position.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return position;
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
}

function handleConstructionClick(position) {
  if (currentTool === "point") {
    mutate(() => {
      const result = documentModel.addPointAt(position, settings, selectionTolerance());
      selectOnly(result.point.id);
      if (result.snappedToIntersection) showToast("已吸附为动态交点");
    });
    return;
  }

  if (currentTool === "midpoint" || currentTool === "perpendicularBisector") {
    const tolerance = selectionTolerance();
    const pointHit = documentModel.hitTestPoint(position, tolerance);
    const objectHit = pointHit || documentModel.hitTest(position, tolerance);
    if (!pendingId && objectHit?.object.type === "segment") {
      mutate(() => {
        const object = currentTool === "midpoint"
          ? documentModel.addMidpoint(objectHit.object.pointAId, objectHit.object.pointBId, settings)
          : documentModel.addPerpendicularBisector(objectHit.object.pointAId, objectHit.object.pointBId, settings);
        selectOnly(object?.id || null);
        pendingId = null;
      });
      return;
    }
    let point = pointHit?.object || null;
    if (!point && currentTool === "perpendicularBisector") {
      if (!constructionStartSnapshot) constructionStartSnapshot = documentModel.serialize();
      point = documentModel.addPointAt(position, settings, tolerance).point;
    }
    if (point?.type !== "point") {
      showToast(`请选择一条线段，或依次选择两个点创建${currentTool === "midpoint" ? "中点" : "中垂线"}`);
      return;
    }
    if (!pendingId) {
      if (currentTool === "perpendicularBisector" && !constructionStartSnapshot) {
        constructionStartSnapshot = documentModel.serialize();
      }
      pendingId = point.id;
      selectOnly(point.id);
      render();
      return;
    }
    if (pendingId === point.id) {
      showToast("请选择另一个点");
      return;
    }
    if (currentTool === "midpoint") {
      mutate(() => {
        const object = documentModel.addMidpoint(pendingId, point.id, settings);
        selectOnly(object?.id || null);
        pendingId = null;
      });
    } else {
      const snapshot = constructionStartSnapshot || documentModel.serialize();
      const object = documentModel.addPerpendicularBisector(pendingId, point.id, settings);
      if (!object) {
        showToast("无法用这两个点创建中垂线");
        return;
      }
      history.recordSnapshot(snapshot);
      constructionStartSnapshot = null;
      pendingId = null;
      selectOnly(object.id);
      afterDocumentChange();
    }
    return;
  }

  if (["angleBisector", "threePointCircle"].includes(currentTool)) {
    const tolerance = selectionTolerance();
    let point = documentModel.hitTestPoint(position, tolerance)?.object || null;
    if (!point && currentTool === "angleBisector") {
      if (!constructionStartSnapshot) constructionStartSnapshot = documentModel.serialize();
      point = documentModel.addPointAt(position, settings, tolerance).point;
    }
    if (point?.type !== "point") {
      showToast(currentTool === "angleBisector" ? "请选择或直接点出一个点" : "请点击已有的点");
      return;
    }
    if (constructionPointIds.includes(point.id)) {
      showToast("每一步请选择不同的点");
      return;
    }
    if (currentTool === "angleBisector" && !constructionStartSnapshot) {
      constructionStartSnapshot = documentModel.serialize();
    }
    constructionPointIds.push(point.id);
    setSelection(constructionPointIds, point.id);
    if (constructionPointIds.length < 3) {
      showToast(currentTool === "angleBisector"
        ? (constructionPointIds.length === 1 ? "已选第一边上的点，请选择顶点" : "已选顶点，请选择第二边上的点")
        : `已选择 ${constructionPointIds.length} 个点，还需 ${3 - constructionPointIds.length} 个`);
      render();
      return;
    }
    const [firstId, secondId, thirdId] = constructionPointIds;
    const snapshot = constructionStartSnapshot || documentModel.serialize();
    const shape = currentTool === "angleBisector"
      ? documentModel.addAngleBisector(secondId, firstId, thirdId, settings)
      : documentModel.addThreePointCircle(firstId, secondId, thirdId, settings);
    constructionPointIds = [];
    if (!shape || !documentModel.getShapeGeometry(shape)) {
      if (constructionStartSnapshot) documentModel = GeometryDocument.fromJSON(constructionStartSnapshot);
      else if (shape) documentModel.removeWithDependents(shape.id);
      constructionStartSnapshot = null;
      clearSelection();
      showToast(currentTool === "threePointCircle" ? "三个点不能共线" : "这三个点无法确定夹角");
      render();
      return;
    }
    history.recordSnapshot(snapshot);
    constructionStartSnapshot = null;
    selectOnly(shape.id);
    afterDocumentChange();
    return;
  }

  if (currentTool === "parallel" || currentTool === "perpendicular") {
    if (!pendingId) {
      const hit = documentModel.hitTestPoint(position, selectionTolerance());
      if (hit?.object.type !== "point") {
        showToast("请先选择直线要经过的点");
        return;
      }
      pendingId = hit.object.id;
      selectOnly(hit.object.id);
      render();
      return;
    }
    const lineHit = documentModel.hitTestShapes(position, selectionTolerance())
      .find((hit) => documentModel.getShapeGeometry(hit.object.id)?.kind === "line");
    if (!lineHit) {
      showToast("请选择一条直线或线段作为基准");
      return;
    }
    mutate(() => {
      const line = currentTool === "parallel"
        ? documentModel.addParallelLine(pendingId, lineHit.object.id, settings)
        : documentModel.addPerpendicularLine(pendingId, lineHit.object.id, settings);
      selectOnly(line?.id || null);
      pendingId = null;
    });
    return;
  }

  if (["segment", "line", "ray", "circle"].includes(currentTool)) {
    if (!pendingId) {
      constructionStartSnapshot = documentModel.serialize();
      const result = documentModel.addPointAt(position, settings, selectionTolerance());
      pendingId = result.point.id;
      selectOnly(result.point.id);
      render();
      return;
    }
    if (currentTool === "circle") {
      const radiusHit = documentModel.hitTest(position, selectionTolerance());
      if (radiusHit?.object.type === "segment") {
        const shape = documentModel.addCircleWithSegmentRadius(pendingId, radiusHit.object.id, settings);
        if (!shape) {
          showToast("线段长度必须大于 0");
          return;
        }
        if (constructionStartSnapshot) history.recordSnapshot(constructionStartSnapshot);
        constructionStartSnapshot = null;
        selectOnly(shape?.id || null);
        pendingId = null;
        afterDocumentChange();
        showToast("已按所选线段长度构造动态半径圆");
        return;
      }
    }
    const result = documentModel.addPointAt(position, settings, selectionTolerance());
    if (pendingId === result.point.id) {
      showToast("请选择另一个点");
      return;
    }
    const shape = currentTool === "circle"
      ? documentModel.addCircle(pendingId, result.point.id, settings)
      : currentTool === "line"
        ? documentModel.addLine(pendingId, result.point.id, settings)
        : currentTool === "ray"
          ? documentModel.addRay(pendingId, result.point.id, settings)
          : documentModel.addSegment(pendingId, result.point.id, settings);
    if (!shape) {
      showToast(currentTool === "circle" ? "圆的半径必须大于 0" : "无法用这两个点完成构造");
      return;
    }
    if (constructionStartSnapshot) history.recordSnapshot(constructionStartSnapshot);
    constructionStartSnapshot = null;
    selectOnly(shape?.id || null);
    pendingId = null;
    afterDocumentChange();
    return;
  }

}

function selectOrCreateIntersection(position, tolerance, requiredParentId = null) {
  const nearest = documentModel.findNearestIntersection(position, tolerance * 2);
  if (!nearest) return false;
  if (requiredParentId && !nearest.parents.includes(requiredParentId)) return false;

  const pointAtIntersection = documentModel.objects.find((object) => {
    if (object.type !== "point" || object.definition?.kind !== "intersection") return false;
    const parents = object.definition.parents || [];
    return object.definition.branch === nearest.branch
      && parents.length === 2
      && parents.every((id) => nearest.parents.includes(id));
  });
  if (pointAtIntersection) {
    selectOnly(pointAtIntersection.id);
    showToast("已选中交点");
    render();
    return true;
  }

  mutate(() => {
    const point = documentModel.addIntersectionPoint(
      nearest.parents[0], nearest.parents[1], nearest.branch, settings,
    );
    selectOnly(point.id);
  });
  showToast("已创建动态交点");
  return true;
}

async function handleSinglePointerDown(event) {
  const snapsConstructionPoint = [
    "point", "segment", "line", "ray", "circle", "perpendicularBisector", "angleBisector",
  ].includes(currentTool);
  pointerWorld = clientToWorld(event, snapsConstructionPoint);
  pointerWorld = constrainConstructionPosition(pointerWorld, event);
  try { elements.geometryCanvas.focus({ preventScroll: true }); } catch {}
  if (event.button === 1 || event.button === 2 || (event.button === 0 && spacePanActive)) {
    event.preventDefault();
    panState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view: { ...view } };
    elements.geometryCanvas.classList.add("panning");
    captureCanvasPointer(event.pointerId);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();

  if (currentTool === "info") {
    const hit = documentModel.hitTest(pointerWorld, selectionTolerance());
    if (!hit) {
      elements.infoPanel.hidden = true;
      return;
    }
    showObjectInformation(hit.object, event.shiftKey);
    return;
  }

  if (currentTool === "text") {
    const hit = documentModel.hitTest(pointerWorld, selectionTolerance());
    const existing = hit?.object.type === "text" ? hit.object : null;
    const content = await askUser(existing ? "编辑文本" : "输入文本", existing?.content || "", { title: existing ? "编辑文本" : "新建文本", multiline: true });
    if (content !== null && (existing || content.trim())) {
      const removedEmptyText = Boolean(existing && !content.trim());
      mutate(() => {
        if (existing) {
          documentModel.updateText(existing.id, content);
          selectOnly(documentModel.getObject(existing.id) ? existing.id : null);
        } else {
          const text = documentModel.addText(pointerWorld, content, settings);
          selectOnly(text?.id || null);
        }
      });
      if (removedEmptyText) showToast("空文本已删除，可用撤销恢复");
    }
    return;
  }

  if (currentTool === "marker") {
    const tolerance = selectionTolerance();
    const shapeHits = documentModel.hitTestShapes(pointerWorld, tolerance);
    if (event.shiftKey) {
      const doodleHit = shapeHits.find((hit) => hit.object.type === "doodle");
      if (doodleHit) {
        mutate(() => documentModel.removeWithDependents(doodleHit.object.id));
        showToast("已擦除手绘标识");
      } else showToast("按住 Shift 点击手绘线可擦除");
      return;
    }
    const existingMark = shapeHits
      .find((hit) => hit.object.type === "angleMark");
    if (existingMark) {
      mutate(() => {
        documentModel.cycleAngleMark(existingMark.object.id);
        selectOnly(existingMark.object.id);
      });
      const count = documentModel.getObject(existingMark.object.id)?.strokeCount || 1;
      showToast(`角标识已切换为 ${count} 道弧线`);
      return;
    }
    const existingPathMark = shapeHits.find((hit) => hit.object.type === "pathMark");
    if (existingPathMark) {
      pathMarkDragState = {
        markId: existingPathMark.object.id,
        start: { ...pointerWorld },
        current: { ...pointerWorld },
        pointerId: event.pointerId,
        snapshot: documentModel.serialize(),
        moved: false,
      };
      selectOnly(existingPathMark.object.id);
      captureCanvasPointer(event.pointerId);
      render();
      return;
    }
    const vertexHit = documentModel.hitTestPoint(pointerWorld, tolerance);
    if (vertexHit?.object.type === "point") {
      markerState = {
        vertexId: vertexHit.object.id,
        start: { ...pointerWorld },
        current: { ...pointerWorld },
        pointerId: event.pointerId,
      };
      selectOnly(vertexHit.object.id);
      captureCanvasPointer(event.pointerId);
      render();
      return;
    }
    const lineHit = shapeHits.find((hit) => documentModel.getShapeGeometry(hit.object)?.kind === "line");
    if (lineHit) {
      mutate(() => {
        const mark = documentModel.addPathMark(lineHit.object.id, pointerWorld, settings);
        selectOnly(mark?.id || null);
      });
      showToast("已添加等长刻痕；点击标识可切换 1～4 道");
      return;
    }
    doodleState = {
      points: [{ ...pointerWorld }],
      pointerId: event.pointerId,
    };
    captureCanvasPointer(event.pointerId);
    renderPreview();
    return;
  }

  if (currentTool === "select") {
    const labelPointId = event.target?.closest?.("[data-label-for]")?.getAttribute("data-label-for");
    if (labelPointId && documentModel.isPoint(labelPointId)) {
      const point = documentModel.getObject(labelPointId);
      selectOnly(labelPointId);
      dragState = {
        kind: "label",
        pointId: labelPointId,
        pointerId: event.pointerId,
        start: { ...pointerWorld },
        originalOffset: { ...(point.labelOffset || { x: 12, y: -12 }) },
        snapshot: documentModel.serialize(),
        changed: false,
      };
      captureCanvasPointer(event.pointerId);
      render();
      return;
    }
    const tolerance = selectionTolerance();
    const hit = documentModel.hitTest(pointerWorld, tolerance);
    if (hit?.object.type === "actionButton" && !event.shiftKey && !isSelected(hit.object.id)) {
      await executeActionButton(hit.object);
      return;
    }
    const editingActionButton = hit?.object.type === "actionButton" && event.shiftKey;
    const hitShape = documentModel.isShape(hit?.object.id);
    const hitIntersectionPoint = hit?.object.type === "point"
      && ["intersection", "other-intersection"].includes(hit.object.definition?.kind);
    if (!event.shiftKey && (hitShape || hitIntersectionPoint) &&
      selectOrCreateIntersection(pointerWorld, tolerance, hitShape ? hit.object.id : null)) return;
    if (!hit) {
      const baseSelection = event.shiftKey ? new Set(selectedIds) : new Set();
      if (!event.shiftKey) clearSelection();
      marqueeState = {
        start: { ...pointerWorld },
        current: { ...pointerWorld },
        baseSelection,
        pointerId: event.pointerId,
      };
      captureCanvasPointer(event.pointerId);
      render();
      return;
    }

    if (event.shiftKey && !editingActionButton) {
      const next = new Set(selectedIds);
      if (next.has(hit.object.id)) next.delete(hit.object.id);
      else next.add(hit.object.id);
      setSelection([...next], hit.object.id);
      render();
      return;
    }

    const primaryBefore = selectedId;
    const selectionIntent = selectionDragIntent(selectedIds, hit.object.id);
    const wasSelected = selectionIntent.wasSelected;
    if (!wasSelected) {
      setSelection(selectionIntent.pointerDownSelection, hit.object.id);
    } else selectedId = hit.object.id;
    const dragSelectionState = {
      clickedId: hit.object.id,
      toggleOnClick: wasSelected,
      exclusiveOnDrag: selectionIntent.exclusiveOnDrag,
      exclusiveSelectionApplied: false,
      dragSelection: selectionIntent.dragSelection,
      selectionBefore: selectionIntent.before,
      primaryBefore,
      startClient: { x: event.clientX, y: event.clientY },
    };

    if (hit.object.locked) {
      dragState = {
        kind: "selectionClick", ...dragSelectionState,
        pointerId: event.pointerId, start: { ...pointerWorld }, changed: false,
        blockedReason: "对象已锁定；可在“显示”菜单中解除锁定",
      };
      captureCanvasPointer(event.pointerId);
      render();
      return;
    }

    if (["text", "measurement", "parameter", "calculation", "table", "actionButton", "image"].includes(hit.object.type) && selectionIntent.dragSelection.length === 1) {
      dragState = {
        kind: "text",
        textId: hit.object.id,
        pointerId: event.pointerId,
        start: { ...pointerWorld },
        original: { x: hit.object.x, y: hit.object.y },
        snapshot: documentModel.serialize(),
        ...dragSelectionState,
        changed: false,
      };
      captureCanvasPointer(event.pointerId);
    } else if (hit.object.type === "point" && selectionIntent.dragSelection.length === 1 && documentModel.isPointDirectlyMovable(hit.object)) {
      dragState = {
        kind: "point",
        pointId: hit.object.id,
        pointerId: event.pointerId,
        start: { ...pointerWorld },
        snapshot: documentModel.serialize(),
        ...dragSelectionState,
        changed: false,
      };
      captureCanvasPointer(event.pointerId);
    } else {
      const objectIds = selectionIntent.dragSelection;
      if (documentModel.canTranslateObjects(objectIds)) {
        dragState = {
          kind: "translation",
          pointerId: event.pointerId,
          start: { ...pointerWorld },
          last: { ...pointerWorld },
          objectIds,
          snapshot: documentModel.serialize(),
          ...dragSelectionState,
          changed: false,
        };
        captureCanvasPointer(event.pointerId);
      } else {
        dragState = {
          kind: "selectionClick",
          ...dragSelectionState,
          pointerId: event.pointerId,
          start: { ...pointerWorld },
          blockedReason: "该对象由数据或固定坐标决定，不能直接拖动",
          changed: false,
        };
        captureCanvasPointer(event.pointerId);
      }
    }
    render();
    return;
  }
  if (["segment", "line", "ray", "circle"].includes(currentTool) && !pendingId) {
    handleConstructionClick(pointerWorld);
    if (pendingId) {
      constructionDragState = {
        pointerId: event.pointerId,
        start: { ...pointerWorld },
        current: { ...pointerWorld },
        moved: false,
      };
      captureCanvasPointer(event.pointerId);
    }
    return;
  }
  handleConstructionClick(pointerWorld);
}

function activeInteractionPointerId() {
  return panState?.pointerId ?? dragState?.pointerId ?? markerState?.pointerId ??
    pathMarkDragState?.pointerId ?? doodleState?.pointerId ?? constructionDragState?.pointerId ??
    marqueeState?.pointerId ?? null;
}

function handleSinglePointerMove(event) {
  const ownerPointerId = activeInteractionPointerId();
  if (ownerPointerId !== null && ownerPointerId !== event.pointerId) return;
  const snapPointDrag = dragState?.kind === "point";
  const snapConstruction = Boolean(constructionDragState ||
    (pendingId && ["segment", "line", "ray", "circle"].includes(currentTool)));
  pointerWorld = clientToWorld(event, snapPointDrag || snapConstruction);
  pointerWorld = constrainConstructionPosition(pointerWorld, event);
  elements.statusCoordinates.textContent = `x ${pointerWorld.x.toFixed(1)} · y ${pointerWorld.y.toFixed(1)}`;
  if (panState) {
    const rect = elements.geometryCanvas.getBoundingClientRect();
    view = panViewFromClientDelta(
      panState.view,
      rect,
      { x: panState.startX, y: panState.startY },
      { x: event.clientX, y: event.clientY },
    );
    scheduleRender();
    return;
  }
  if (dragState) {
    if (dragState.exclusiveOnDrag && !dragState.exclusiveSelectionApplied) {
      if (!hasExceededDragThreshold(
        dragState.startClient,
        { x: event.clientX, y: event.clientY },
      )) return;
      setSelection(dragState.dragSelection, dragState.clickedId);
      dragState.exclusiveSelectionApplied = true;
      scheduleRender();
    }
    if (dragState.kind === "selectionClick") {
      if (dragState.blockedReason && !dragState.feedbackShown && dragState.start && Math.hypot(
        pointerWorld.x - dragState.start.x,
        pointerWorld.y - dragState.start.y,
      ) > selectionTolerance() * 0.4) {
        dragState.feedbackShown = true;
        showToast(dragState.blockedReason, "warning");
      }
      return;
    }
    if (dragState.kind === "point") {
      if (Math.hypot(pointerWorld.x - dragState.start.x, pointerWorld.y - dragState.start.y) > 0.001) {
        dragState.changed = documentModel.movePoint(dragState.pointId, pointerWorld) || dragState.changed;
      }
    } else if (dragState.kind === "text") {
      const delta = { x: pointerWorld.x - dragState.start.x, y: pointerWorld.y - dragState.start.y };
      documentModel.moveText(dragState.textId, {
        x: dragState.original.x + delta.x,
        y: dragState.original.y + delta.y,
      });
      dragState.changed = Math.abs(delta.x) > 0.001 || Math.abs(delta.y) > 0.001;
    } else if (dragState.kind === "label") {
      const delta = { x: pointerWorld.x - dragState.start.x, y: pointerWorld.y - dragState.start.y };
      documentModel.setPointLabelOffset(dragState.pointId, {
        x: dragState.originalOffset.x + delta.x,
        y: dragState.originalOffset.y + delta.y,
      }, 32);
      dragState.changed = Math.abs(delta.x) > 0.001 || Math.abs(delta.y) > 0.001;
    } else {
      const delta = { x: pointerWorld.x - dragState.last.x, y: pointerWorld.y - dragState.last.y };
      dragState.changed = documentModel.translateObjects(dragState.objectIds, delta) || dragState.changed;
      dragState.last = { ...pointerWorld };
    }
    scheduleRender();
    return;
  }
  if (markerState) {
    markerState.current = { ...pointerWorld };
    renderPreview();
    return;
  }
  if (pathMarkDragState) {
    pathMarkDragState.current = { ...pointerWorld };
    const moved = Math.hypot(
      pointerWorld.x - pathMarkDragState.start.x,
      pointerWorld.y - pathMarkDragState.start.y,
    ) > selectionTolerance() * 0.5;
    if (moved) {
      pathMarkDragState.moved = true;
      documentModel.movePathMark(pathMarkDragState.markId, pointerWorld);
      scheduleRender();
    }
    return;
  }
  if (doodleState) {
    const last = doodleState.points.at(-1);
    if (!last || Math.hypot(pointerWorld.x - last.x, pointerWorld.y - last.y) >= view.width / 600) {
      doodleState.points.push({ ...pointerWorld });
      renderPreview();
    }
    return;
  }
  if (constructionDragState) {
    constructionDragState.current = { ...pointerWorld };
    constructionDragState.moved = constructionDragState.moved || Math.hypot(
      constructionDragState.current.x - constructionDragState.start.x,
      constructionDragState.current.y - constructionDragState.start.y,
    ) > selectionTolerance();
    renderPreview();
    return;
  }
  if (marqueeState) {
    marqueeState.current = { ...pointerWorld };
    renderPreview();
    return;
  }
  renderPreview();
}

function handleSinglePointerUp(event) {
  const ownerPointerId = activeInteractionPointerId();
  if (ownerPointerId !== null && ownerPointerId !== event.pointerId) return;
  if (panState) {
    panState = null;
    elements.geometryCanvas.classList.remove("panning");
    render();
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  if (constructionDragState) {
    const finishedConstruction = constructionDragState;
    constructionDragState = null;
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    if (event.type === "pointercancel") {
      cancelIncompleteConstruction();
      render();
      return;
    }
    if (finishedConstruction.moved) {
      pointerWorld = constrainConstructionPosition(finishedConstruction.current, event);
      handleConstructionClick(pointerWorld);
    } else render();
    return;
  }
  if (pathMarkDragState) {
    const finishedPathMark = pathMarkDragState;
    pathMarkDragState = null;
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    if (event.type === "pointercancel") {
      documentModel = GeometryDocument.fromJSON(finishedPathMark.snapshot);
      render();
      return;
    }
    if (finishedPathMark.moved) {
      if (finishedPathMark.snapshot !== documentModel.serialize()) {
        history.recordSnapshot(finishedPathMark.snapshot);
        afterDocumentChange();
      }
      showToast("已移动路径标识");
    } else {
      mutate(() => documentModel.cyclePathMark(finishedPathMark.markId));
      const count = documentModel.getObject(finishedPathMark.markId)?.strokeCount || 1;
      showToast(`路径标识已切换为 ${count} 道`);
    }
    return;
  }
  if (doodleState) {
    const finishedDoodle = doodleState;
    doodleState = null;
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    if (event.type !== "pointercancel" && finishedDoodle.points.length > 1) {
      mutate(() => {
        const doodle = documentModel.addDoodle(finishedDoodle.points, settings);
        selectOnly(doodle?.id || null);
      });
      showToast("已创建手绘标识；按住 Shift 点击可擦除");
    } else render();
    return;
  }
  if (markerState) {
    const finishedMarker = markerState;
    markerState = null;
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    if (event.type === "pointercancel") {
      render();
      return;
    }
    const vertex = documentModel.getPointPosition(finishedMarker.vertexId);
    const dragDistance = vertex ? Math.hypot(
      finishedMarker.current.x - vertex.x,
      finishedMarker.current.y - vertex.y,
    ) : 0;
    if (!vertex || dragDistance < selectionTolerance()) {
      showToast("请从顶点向角内拖动一小段距离");
      render();
      return;
    }
    const angle = documentModel.findAngleAt(
      finishedMarker.vertexId,
      finishedMarker.current,
      Math.max(2, selectionTolerance() * 0.45),
    );
    if (!angle) {
      showToast("这个顶点附近没有找到两条可标识的边");
      render();
      return;
    }
    mutate(() => {
      const mark = documentModel.addAngleMarkFromSides(
        angle.vertexId,
        angle.sideAId,
        angle.directionA,
        angle.sideBId,
        angle.directionB,
        settings,
        { radius: Math.max(16, Math.min(30, dragDistance * 0.42)) },
      );
      selectOnly(mark?.id || null);
    });
    const mark = documentModel.getObject(selectedId);
    const geometry = mark ? documentModel.getShapeGeometry(mark) : null;
    showToast(geometry?.rightAngle ? "已创建直角标识" : "已创建角标识；点击灰色区域可切换弧线数");
    return;
  }
  if (marqueeState) {
    const finishedMarquee = marqueeState;
    marqueeState = null;
    if (event.type === "pointercancel") {
      setSelection([...finishedMarquee.baseSelection]);
      try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
      render();
      return;
    }
    const width = Math.abs(finishedMarquee.current.x - finishedMarquee.start.x);
    const height = Math.abs(finishedMarquee.current.y - finishedMarquee.start.y);
    if (width > selectionTolerance() || height > selectionTolerance()) {
      const hits = documentModel.objectsInRect({
        x1: finishedMarquee.start.x,
        y1: finishedMarquee.start.y,
        x2: finishedMarquee.current.x,
        y2: finishedMarquee.current.y,
      });
      const combined = new Set(finishedMarquee.baseSelection);
      for (const object of hits) combined.add(object.id);
      setSelection([...combined], hits.at(-1)?.id || [...combined].at(-1) || null);
    } else {
      setSelection([...finishedMarquee.baseSelection]);
    }
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    render();
    return;
  }
  if (!dragState) return;
  const finishedDrag = dragState;
  if (event.type === "pointercancel") {
    dragState = null;
    if (finishedDrag.snapshot) documentModel = GeometryDocument.fromJSON(finishedDrag.snapshot);
    if (Array.isArray(finishedDrag.selectionBefore)) {
      setSelection(finishedDrag.selectionBefore, finishedDrag.primaryBefore);
    }
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    render();
    return;
  }
  if (finishedDrag.changed && finishedDrag.snapshot !== documentModel.serialize()) {
    history.recordSnapshot(finishedDrag.snapshot);
    afterDocumentChange();
  } else if (!finishedDrag.changed && finishedDrag.toggleOnClick && finishedDrag.clickedId) {
    const next = new Set(selectedIds);
    next.delete(finishedDrag.clickedId);
    setSelection([...next]);
    render();
  }
  dragState = null;
  try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
}

function pointerSample(event, type = event.type) {
  return {
    type,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button ?? 0,
    buttons: event.buttons ?? 0,
    shiftKey: Boolean(event.shiftKey),
    altKey: Boolean(event.altKey),
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    target: event.target,
    preventDefault() {},
  };
}

function touchPoint(sample) {
  return { x: sample.clientX, y: sample.clientY };
}

function touchPairMetrics(first, second) {
  const a = touchPoint(first);
  const b = touchPoint(second);
  return {
    centroid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.max(1e-6, Math.hypot(a.x - b.x, a.y - b.y)),
  };
}

function touchCanStartDrag(intent) {
  if (["segment", "line", "ray", "circle", "marker"].includes(currentTool)) return true;
  if (currentTool !== "select") return false;
  const objectId = intent.down.target?.closest?.("[data-object-id]")?.getAttribute("data-object-id");
  return documentModel.getObject(objectId)?.type !== "actionButton";
}

function beginTouchGesture(secondPointerId) {
  const firstPointerId = touchIntent?.pointerId;
  const first = activeTouchPoints.get(firstPointerId);
  const second = activeTouchPoints.get(secondPointerId);
  if (!first || !second) return false;
  const metrics = touchPairMetrics(first, second);
  touchGesture = {
    phase: "pinch",
    pointerIds: [firstPointerId, secondPointerId],
    startView: { ...view },
    startCentroid: metrics.centroid,
    startDistance: Math.max(4, metrics.distance),
  };
  touchIntent = null;
  elements.geometryCanvas.classList.add("panning");
  return true;
}

function endTouchGesture() {
  touchGesture = null;
  elements.geometryCanvas.classList.remove("panning");
}

function handleTouchPointerDown(event) {
  event.preventDefault();
  const sample = pointerSample(event, "pointerdown");
  activeTouchPoints.set(event.pointerId, sample);
  captureCanvasPointer(event.pointerId);
  if (nonTouchPointerId !== null || ignoredNonTouchPointers.size) {
    ignoredTouchPointers.add(event.pointerId);
    touchDrainActive = true;
    return;
  }
  if (touchGesture) {
    ignoredTouchPointers.add(event.pointerId);
    return;
  }
  if (!touchIntent) {
    if (touchDrainActive || activeTouchPoints.size !== 1 || ignoredTouchPointers.size) {
      ignoredTouchPointers.add(event.pointerId);
      touchDrainActive = true;
      return;
    }
    touchIntent = {
      pointerId: event.pointerId,
      down: sample,
      start: touchPoint(sample),
      activated: false,
    };
    return;
  }
  if (!touchIntent.activated && beginTouchGesture(event.pointerId)) return;
  ignoredTouchPointers.add(event.pointerId);
}

async function handleTouchPointerMove(event) {
  if (!activeTouchPoints.has(event.pointerId)) return;
  const sample = pointerSample(event, "pointermove");
  activeTouchPoints.set(event.pointerId, sample);
  if (touchGesture) {
    if (!touchGesture.pointerIds.includes(event.pointerId)) return;
    const rect = elements.geometryCanvas.getBoundingClientRect();
    if (touchGesture.phase === "pinch") {
      const first = activeTouchPoints.get(touchGesture.pointerIds[0]);
      const second = activeTouchPoints.get(touchGesture.pointerIds[1]);
      if (!first || !second) return;
      const metrics = touchPairMetrics(first, second);
      view = fitViewToGesture(
        touchGesture.startView,
        rect,
        touchGesture.startCentroid,
        touchGesture.startDistance,
        metrics.centroid,
        Math.max(4, metrics.distance),
        { minWidth: 180, maxWidth: 8000 },
      );
    } else {
      view = panViewFromClientDelta(
        touchGesture.startView,
        rect,
        touchGesture.startPoint,
        touchPoint(sample),
      );
    }
    scheduleRender();
    return;
  }
  if (ignoredTouchPointers.has(event.pointerId) || touchIntent?.pointerId !== event.pointerId) return;
  if (touchIntent.activated) {
    handleSinglePointerMove(sample);
    return;
  }
  const movement = Math.hypot(sample.clientX - touchIntent.start.x, sample.clientY - touchIntent.start.y);
  if (movement < 8 || !touchCanStartDrag(touchIntent)) return;
  const intent = touchIntent;
  intent.activated = true;
  intent.epoch = interactionEpoch;
  intent.activationPromise = (async () => {
    try {
      await handleSinglePointerDown(intent.down);
      return true;
    } catch (error) {
      console.error("触摸操作启动失败。", error);
      if (activeInteractionPointerId() === intent.pointerId) {
        handleSinglePointerUp({ ...intent.down, type: "pointercancel" });
      }
      return false;
    }
  })();
  const started = await intent.activationPromise;
  if (started && intent.epoch === interactionEpoch && touchIntent === intent && !touchGesture) {
    handleSinglePointerMove(sample);
  }
}

async function handleTouchPointerUp(event) {
  if (touchEndInProgress.has(event.pointerId)) return;
  touchEndInProgress.add(event.pointerId);
  try {
    const sample = pointerSample(event, event.type === "pointercancel" ? "pointercancel" : "pointerup");
    const wasActive = activeTouchPoints.has(event.pointerId);
    activeTouchPoints.delete(event.pointerId);
    if (touchGesture && touchGesture.pointerIds.includes(event.pointerId)) {
      const remainingId = touchGesture.pointerIds.find((pointerId) => activeTouchPoints.has(pointerId));
      if (remainingId) {
        const remaining = activeTouchPoints.get(remainingId);
        touchGesture = {
          phase: "pan",
          pointerIds: [remainingId],
          startView: { ...view },
          startPoint: touchPoint(remaining),
        };
      } else {
        endTouchGesture();
        touchDrainActive = activeTouchPoints.size > 0;
      }
      render();
      try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
      return;
    }
    if (touchGesture) {
      ignoredTouchPointers.delete(event.pointerId);
      try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
      return;
    }
    if (ignoredTouchPointers.has(event.pointerId)) {
      ignoredTouchPointers.delete(event.pointerId);
      if (!activeTouchPoints.size) touchDrainActive = false;
      try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
      return;
    }
    if (!wasActive || touchIntent?.pointerId !== event.pointerId) return;
    const intent = touchIntent;
    touchIntent = null;
    const epoch = intent.epoch ?? interactionEpoch;
    try {
      if (intent.activated) {
        const started = await intent.activationPromise;
        if (started && epoch === interactionEpoch) handleSinglePointerUp(sample);
      } else if (sample.type !== "pointercancel") {
        await handleSinglePointerDown(intent.down);
        if (epoch === interactionEpoch) handleSinglePointerUp(sample);
        else if (activeInteractionPointerId() === intent.pointerId) {
          handleSinglePointerUp({ ...sample, type: "pointercancel" });
        }
      }
    } catch (error) {
      console.error("触摸操作未完成。", error);
      if (activeInteractionPointerId() === intent.pointerId) {
        handleSinglePointerUp({ ...sample, type: "pointercancel" });
      }
    } finally {
      if (activeTouchPoints.size) touchDrainActive = true;
      else {
        touchDrainActive = false;
        ignoredTouchPointers.clear();
      }
      try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    }
  } finally {
    touchEndInProgress.delete(event.pointerId);
  }
}

function handlePointerDown(event) {
  if (event.pointerType === "touch") return handleTouchPointerDown(event);
  if (touchIntent || touchGesture || touchDrainActive || activeTouchPoints.size ||
    (nonTouchPointerId !== null && nonTouchPointerId !== event.pointerId)) {
    event.preventDefault();
    ignoredNonTouchPointers.add(event.pointerId);
    captureCanvasPointer(event.pointerId);
    return;
  }
  nonTouchPointerId = event.pointerId;
  return handleSinglePointerDown(event);
}

function handlePointerMove(event) {
  if (event.pointerType === "touch") return handleTouchPointerMove(event);
  if (ignoredNonTouchPointers.has(event.pointerId)) return;
  if (nonTouchPointerId === null) {
    if (touchIntent || touchGesture || touchDrainActive || activeTouchPoints.size) return;
  } else if (nonTouchPointerId !== event.pointerId) return;
  return handleSinglePointerMove(event);
}

function handlePointerUp(event) {
  if (event.pointerType === "touch") return handleTouchPointerUp(event);
  if (ignoredNonTouchPointers.has(event.pointerId)) {
    ignoredNonTouchPointers.delete(event.pointerId);
    try { elements.geometryCanvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  if (nonTouchPointerId !== event.pointerId) return;
  try { return handleSinglePointerUp(event); }
  finally { nonTouchPointerId = null; }
}

function handleLostPointerCapture(event) {
  if (touchEndInProgress.has(event.pointerId)) return;
  if (activeTouchPoints.has(event.pointerId) || touchIntent?.pointerId === event.pointerId ||
    touchGesture?.pointerIds.includes(event.pointerId)) {
    handleTouchPointerUp(pointerSample(event, "pointercancel"));
    return;
  }
  if (ignoredNonTouchPointers.has(event.pointerId)) {
    ignoredNonTouchPointers.delete(event.pointerId);
    return;
  }
  if (nonTouchPointerId === event.pointerId || activeInteractionPointerId() === event.pointerId) {
    handleSinglePointerUp(pointerSample(event, "pointercancel"));
    nonTouchPointerId = null;
  }
}

function handleWheel(event) {
  event.preventDefault();
  const rect = elements.geometryCanvas.getBoundingClientRect();
  const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
  const normalizedDelta = Math.max(-240, Math.min(240, event.deltaY * deltaUnit));
  const factor = Math.exp(normalizedDelta * 0.0015);
  view = zoomViewAtClientPoint(
    view, rect, { x: event.clientX, y: event.clientY }, factor, { minWidth: 180, maxWidth: 8000 },
  );
  scheduleRender();
}

async function handleDoubleClick(event) {
  if (currentTool !== "select" || event.button !== 0) return;
  const labelPointId = event.target.closest?.("[data-label-for]")?.dataset.labelFor;
  if (labelPointId && documentModel.isPoint(labelPointId)) {
    event.preventDefault();
    selectOnly(labelPointId);
    render();
    requestAnimationFrame(() => {
      elements.pointName.focus();
      elements.pointName.select();
    });
    return;
  }
  const position = clientToWorld(event);
  const directId = event.target.closest?.("[data-object-id]")?.dataset.objectId;
  const directObject = directId ? documentModel.getObject(directId) : null;
  const object = directObject || documentModel.hitTest(position, selectionTolerance())?.object;
  if (!object || !["text", "parameter"].includes(object.type)) return;
  event.preventDefault();
  if (object.type === "parameter") {
    const value = await askUser(`修改参数 ${object.name}`, String(object.value), { title: "参数" });
    if (value == null || Number(value) === object.value || !Number.isFinite(Number(value))) return;
    mutate(() => {
      documentModel.setParameterValue(object.id, Number(value));
      selectOnly(object.id);
    });
    return;
  }
  const content = await askUser("编辑文本", object.content, { title: "编辑文本", multiline: true });
  if (content === null || content === object.content) return;
  const removedEmptyText = !content.trim();
  mutate(() => {
    documentModel.updateText(object.id, content);
    selectOnly(documentModel.getObject(object.id) ? object.id : null);
  });
  if (removedEmptyText) showToast("空文本已删除，可用撤销恢复");
}

function deleteSelection() {
  if (cancelIncompleteConstruction()) {
    afterDocumentChange();
    return;
  }
  if (!selectedIds.size) return;
  const idsToDelete = [...selectedIds];
  mutate(() => {
    for (const id of idsToDelete) {
      if (documentModel.getObject(id)) documentModel.removeWithDependents(id);
    }
    clearSelection();
    pendingId = null;
    constructionPointIds = [];
  });
}

function hideSelection() {
  if (!selectedIds.size) return;
  const ids = [...selectedIds];
  mutate(() => {
    documentModel.setObjectsHidden(ids, true);
    clearSelection();
  });
  showToast(`已隐藏 ${ids.length} 个对象；其子对象关系仍然保留`);
}

function showAllHidden() {
  const hiddenIds = documentModel.objects.filter((object) => object.hidden).map((object) => object.id);
  if (!hiddenIds.length) return;
  mutate(() => {
    documentModel.setObjectsHidden(hiddenIds, false);
    setSelection(hiddenIds, hiddenIds.at(-1));
  });
  showToast(`已显示 ${hiddenIds.length} 个隐藏对象`);
}

function actionButtonPosition() {
  const count = documentModel.objects.filter((object) => object.type === "actionButton").length;
  return { x: view.x + view.width * 0.72, y: view.y + 42 + count * 42 };
}

async function createActionButton(actionKind) {
  let targets = selectedObjects().filter((object) => object.type !== "actionButton");
  if (actionKind === "animate") targets = targets.filter((object) => object.type === "parameter" ||
    (object.type === "point" && object.definition.kind === "on-shape")).slice(0, 1);
  if (actionKind === "move") {
    if (targets.length !== 2 || targets.some((object) => object.type !== "point") || targets[0].definition.kind !== "free") {
      showToast("请按顺序选择一个自由点和一个目标点"); return;
    }
  }
  if (!["link", "sound"].includes(actionKind) && !targets.length) { showToast(actionKind === "animate" ? "请选择参数或路径上的点" : "请先选择按钮要控制的对象"); return; }
  let options = {};
  if (actionKind === "link") {
    const url = await askUser("链接地址（http:// 或 https://）", "https://", { title: "创建链接按钮" });
    if (!url) return;
    options = { url };
  } else if (actionKind === "sound") {
    const frequency = Number(await askUser("声音频率（80～2000 Hz）", "440", { title: "创建声音按钮" }));
    if (!Number.isFinite(frequency)) return;
    options = { frequency, duration: 0.25 };
  }
  const defaultLabel = { hide: "隐藏对象", show: "显示对象", animate: "开始/停止动画", move: "移动点", link: "打开链接", sound: "播放声音" }[actionKind];
  const label = await askUser("按钮文字", defaultLabel, { title: "创建动作按钮" });
  if (!label?.trim()) return;
  let created = null;
  mutate(() => {
    created = documentModel.addActionButton(actionKind, targets.map((object) => object.id), label, actionButtonPosition(), settings, options);
    clearSelection();
  });
  showToast(created ? "动作按钮已创建；单击执行，Shift+单击可选择和移动" : "无法创建动作按钮");
}

async function executeActionButton(button) {
  if (button.actionKind === "hide" || button.actionKind === "show") {
    mutate(() => documentModel.setObjectsHidden(button.targetIds, button.actionKind === "hide"));
    showToast(button.actionKind === "hide" ? "动作按钮已隐藏对象" : "动作按钮已显示对象");
    return;
  }
  if (button.actionKind === "animate") await toggleAnimationForObject(documentModel.getObject(button.targetIds[0]));
  else if (button.actionKind === "move") {
    const destination = documentModel.getPointPosition(button.targetIds[1]);
    if (destination) mutate(() => documentModel.setFreePointPosition(button.targetIds[0], destination));
  } else if (button.actionKind === "link") window.open(button.url, "_blank", "noopener,noreferrer");
  else if (button.actionKind === "sound") {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { showToast("当前浏览器不支持声音按钮"); return; }
    const context = new AudioContextClass();
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = button.frequency || 440; gain.gain.value = 0.08;
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start();
    oscillator.stop(context.currentTime + (button.duration || 0.25));
    oscillator.addEventListener("ended", () => context.close());
  }
}

async function runDisplayCommand(command) {
  if (command === "showHidden") { showAllHidden(); return; }
  if (command === "clearTrace") {
    traceHistory.clear(); render(); showToast("已清除追踪痕迹"); return;
  }
  if (["hideButton", "showButton", "animateButton", "moveButton", "linkButton", "soundButton"].includes(command)) {
    const actionKind = ({ hideButton: "hide", showButton: "show", animateButton: "animate", moveButton: "move", linkButton: "link", soundButton: "sound" })[command];
    await createActionButton(actionKind);
    return;
  }
  if (command === "saveCustomTool") {
    if (!selectedIds.size) { showToast("请先选择要保存为工具的结果对象"); return; }
    const name = await askUser("自定义工具名称", `工具 ${customTools.length + 1}`, { title: "保存自定义工具" });
    if (!name?.trim()) return;
    const normalized = name.trim().slice(0, 40);
    const tool = { name: normalized, document: documentModel.serialize(), ids: [...selectedIds] };
    const existing = customTools.findIndex((item) => item.name === normalized);
    if (existing >= 0) customTools[existing] = tool; else customTools.push(tool);
    saveCustomTools(); showToast(`自定义工具“${normalized}”已保存`); return;
  }
  if (command === "runCustomTool") {
    if (!customTools.length) { showToast("还没有保存自定义工具"); return; }
    const name = await askUser(`输入工具名称：\n${customTools.map((tool) => tool.name).join("、")}`, customTools[0].name, { title: "使用自定义工具" });
    const tool = customTools.find((item) => item.name === name?.trim());
    if (!tool) { if (name != null) showToast("没有找到这个自定义工具"); return; }
    mutate(() => {
      const source = GeometryDocument.fromJSON(tool.document);
      const created = documentModel.importObjects(source, tool.ids, { x: 32, y: 32 });
      setSelection(created.map((object) => object.id), created.at(-1)?.id || null);
    });
    showToast(`已使用自定义工具“${tool.name}”`); return;
  }
  const ids = [...selectedIds];
  if (!ids.length) { showToast("请先选择对象"); return; }
  if (command === "hide") { hideSelection(); return; }
  if (command === "toggleLabels") { toggleSelectedPointLabels(); return; }
  if (command === "lock" || command === "unlock") {
    mutate(() => documentModel.setObjectsLocked(ids, command === "lock"));
    showToast(command === "lock" ? "已锁定选中对象" : "已解除锁定");
    return;
  }
  if (command === "front" || command === "back") {
    mutate(() => documentModel.reorderObjects(ids, command));
    showToast(command === "front" ? "已移到最前" : "已移到最后");
    return;
  }
  if (command === "trace") {
    const points = selectedObjects().filter((object) => object.type === "point");
    if (!points.length) { showToast("点追踪需要选择一个或多个点"); return; }
    const enabled = points.some((point) => !point.trace);
    mutate(() => documentModel.setObjectsTracing(points.map((point) => point.id), enabled));
    showToast(enabled ? "已开启点追踪" : "已关闭点追踪");
  }
}

async function toggleAnimationForObject(object) {
  if (!object) { showToast("请选择一个参数或路径上的点"); return; }
  if (animationTimers.has(object.id)) {
    clearInterval(animationTimers.get(object.id));
    animationTimers.delete(object.id);
    autosave(); showToast("动画已停止"); return;
  }
  const rawStep = await askUser(object.type === "parameter" ? "每帧参数增量" : "动画速度（0.01～0.2）", object.type === "parameter" ? "0.05" : "0.03", { title: "动画设置" });
  if (rawStep == null) return;
  const step = Number(rawStep);
  if (!Number.isFinite(step) || Math.abs(step) <= 1e-9) { showToast("动画增量必须是非零数值"); return; }
  history.recordSnapshot(documentModel.serialize());
  let direction = 1;
  let frame = 0;
  const timer = setInterval(() => {
    const current = documentModel.getObject(object.id);
    if (!current) { clearInterval(timer); animationTimers.delete(object.id); return; }
    if (current.type === "parameter") current.value += step * direction;
    else {
      const parent = documentModel.getShapeGeometry(current.definition.parentId);
      if (!parent) return;
      current.definition.parameter += step * direction;
      if (parent.kind === "line" && parent.segment && (current.definition.parameter >= 1 || current.definition.parameter <= 0)) {
        current.definition.parameter = Math.max(0, Math.min(1, current.definition.parameter)); direction *= -1;
      } else if (parent.kind === "arc") {
        const start = parent.startAngle;
        const end = parent.startAngle + parent.signedAngle;
        const low = Math.min(start, end); const high = Math.max(start, end);
        if (current.definition.parameter >= high || current.definition.parameter <= low) {
          current.definition.parameter = Math.max(low, Math.min(high, current.definition.parameter)); direction *= -1;
        }
      }
    }
    frame += 1;
    if (frame % 25 === 0) autosave();
    render();
  }, 40);
  animationTimers.set(object.id, timer);
  showToast("动画已开始；再次选择动画命令可停止");
}

async function toggleAnimationForSelection() {
  const object = selectedObjects().find((candidate) => candidate.type === "parameter" ||
    (candidate.type === "point" && candidate.definition.kind === "on-shape"));
  await toggleAnimationForObject(object);
}

function selectAllForCurrentTool() {
  const visibleObjects = documentModel.objects.filter((object) => !object.hidden);
  const matches = currentTool === "point"
    ? visibleObjects.filter((object) => object.type === "point")
    : currentTool === "text"
      ? visibleObjects.filter((object) => object.type === "text")
    : ["segment", "line", "ray"].includes(currentTool)
      ? visibleObjects.filter((object) => object.type === currentTool)
      : currentTool === "circle"
        ? visibleObjects.filter((object) => ["circle", "radiusCircle", "threePointCircle"].includes(object.type))
        : visibleObjects;
  setSelection(matches.map((object) => object.id), matches.at(-1)?.id || null);
  render();
}

function toggleSelectedPointLabels() {
  const points = selectedObjects().filter((object) => object.type === "point");
  if (!points.length) return;
  const shouldShow = points.some((point) => point.style?.showLabel === false);
  mutate(() => {
    for (const point of points) point.style.showLabel = shouldShow;
  });
}

async function batchRenameSelectedPoints() {
  const points = selectedObjects().filter((object) => object.type === "point");
  if (points.length < 2) return;
  const suggestion = points.map((point) => point.label).join(", ");
  const input = await askUser(`按选中顺序输入 ${points.length} 个名称，用逗号分隔。下标可写成 A[1]。`, suggestion, { title: "批量命名" });
  if (!input) return;
  const labels = input.split(/[,，]/).map((label) => label.trim()).filter(Boolean);
  if (labels.length !== points.length) { showToast(`需要恰好输入 ${points.length} 个名称`); return; }
  mutate(() => points.forEach((point, index) => documentModel.renamePoint(point.id, labels[index])));
  showToast(`已批量命名 ${points.length} 个点`);
}

function constructMidpointsFromSelection() {
  const segments = selectedObjects().filter((object) => object.type === "segment");
  if (!segments.length) return false;
  mutate(() => {
    const created = segments
      .map((segment) => documentModel.addMidpoint(segment.pointAId, segment.pointBId, settings))
      .filter(Boolean);
    setSelection(created.map((point) => point.id), created.at(-1)?.id || null);
  });
  showToast(`已构造 ${segments.length} 条线段的中点`);
  return true;
}

function constructSegmentsFromSelection() {
  const points = selectedObjects().filter((object) => object.type === "point");
  if (points.length < 2 || points.length !== selectedIds.size) return false;
  mutate(() => {
    const created = [];
    const pairCount = points.length === 2 ? 1 : points.length;
    for (let index = 0; index < pairCount; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      const segment = documentModel.addSegment(first.id, second.id, settings);
      if (segment) created.push(segment);
    }
    setSelection(created.map((segment) => segment.id), created.at(-1)?.id || null);
  });
  showToast(points.length === 2 ? "已构造线段" : `已按选点顺序构造 ${points.length} 条首尾相连线段`);
  return true;
}

function constructIntersectionsFromSelection() {
  const shapes = selectedObjects().filter((object) => documentModel.getShapeGeometry(object)?.kind);
  if (shapes.length !== 2 || shapes.length !== selectedIds.size) return false;
  const intersections = documentModel.getIntersections(shapes[0].id, shapes[1].id);
  if (!intersections.length) {
    showToast("所选两个对象当前没有交点");
    return true;
  }
  mutate(() => {
    const created = documentModel.addIntersectionPoints(shapes[0].id, shapes[1].id, settings);
    setSelection(created.map((point) => point.id), created.at(-1)?.id || null);
  });
  showToast(`已构造 ${intersections.length} 个动态交点`);
  return true;
}

function constructLinearShapesFromSelection(type) {
  const points = selectedObjects().filter((object) => object.type === "point");
  if (points.length < 2 || points.length !== selectedIds.size) return false;
  mutate(() => {
    const created = [];
    const pairCount = points.length === 2 ? 1 : points.length;
    for (let index = 0; index < pairCount; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      const shape = type === "line"
        ? documentModel.addLine(first.id, second.id, settings)
        : type === "ray"
          ? documentModel.addRay(first.id, second.id, settings)
          : documentModel.addSegment(first.id, second.id, settings);
      if (shape) created.push(shape);
    }
    setSelection(created.map((shape) => shape.id), created.at(-1)?.id || null);
  });
  return true;
}

function constructPerpendicularBisectorsFromSelection() {
  const segments = selectedObjects().filter((object) => object.type === "segment");
  if (!segments.length || segments.length !== selectedIds.size) return false;
  mutate(() => {
    const created = segments.map((segment) => documentModel.addPerpendicularBisector(
      segment.pointAId, segment.pointBId, settings,
    )).filter(Boolean);
    setSelection(created.map((shape) => shape.id), created.at(-1)?.id || null);
  });
  return true;
}

function constructDerivedLinesFromSelection(type) {
  const selection = selectedObjects();
  if (selection.some((object) => object.type === "point" && !documentModel.getPointPosition(object))) return false;
  const pairs = pointLinePairs(
    selection,
    (object) => documentModel.getShapeGeometry(object)?.kind === "line",
  );
  if (!pairs.length) return false;
  let created = [];
  mutate(() => {
    created = pairs.map(({ point, line }) => type === "parallel"
      ? documentModel.addParallelLine(point.id, line.id, settings)
      : documentModel.addPerpendicularLine(point.id, line.id, settings)).filter(Boolean);
    setSelection(created.map((shape) => shape.id), created.at(-1)?.id || null);
  });
  if (!created.length) return false;
  showToast(`已批量构造 ${created.length} 条${type === "parallel" ? "平行线" : "垂线"}`);
  return true;
}

function otherDefiningPoint(shape, vertexId) {
  if (!["segment", "line", "ray"].includes(shape?.type)) return null;
  if (shape.pointAId === vertexId) return shape.pointBId;
  if (shape.pointBId === vertexId) return shape.pointAId;
  return null;
}

function constructAngleBisectorFromSelection() {
  const selection = selectedObjects();
  const points = selection.filter((object) => object.type === "point");
  if (selection.length === 3 && points.length === 3) {
    const preview = documentModel.addAngleBisector(points[1].id, points[0].id, points[2].id, settings);
    const valid = preview && documentModel.getShapeGeometry(preview);
    if (preview) documentModel.removeWithDependents(preview.id);
    if (!valid) return false;
    mutate(() => {
      const created = documentModel.addAngleBisector(points[1].id, points[0].id, points[2].id, settings);
      selectOnly(created?.id || null);
    });
    return true;
  }
  const sides = selection.filter((object) => ["segment", "line", "ray"].includes(object.type));
  if (sides.length !== 2 || sides.length + points.length !== selection.length) return false;
  if (points.length === 0) {
    const definition = angleBisectorFromCommonEndpoint(sides);
    if (!definition) return false;
    mutate(() => {
      const created = documentModel.addAngleBisectorFromSides(
        definition.sideAId,
        definition.sideBId,
        settings,
      );
      selectOnly(created?.id || null);
    });
    return true;
  }
  let vertex = points.length === 1 ? points[0] : null;
  if (!vertex) return false;
  const firstPointId = otherDefiningPoint(sides[0], vertex.id);
  const secondPointId = otherDefiningPoint(sides[1], vertex.id);
  if (!firstPointId || !secondPointId) return false;
  mutate(() => {
    const created = documentModel.addAngleBisector(vertex.id, firstPointId, secondPointId, settings);
    selectOnly(created?.id || null);
  });
  return true;
}

function constructTriangleObjectFromSelection(kind) {
  const selection = selectedObjects();
  const points = selection.filter((object) => object.type === "point");
  if (selection.length !== 3 || points.length !== 3) return false;
  let created = null;
  mutate(() => {
    created = kind === "centroid"
      ? documentModel.addCentroid(points[0].id, points[1].id, points[2].id, settings)
      : kind === "incenter"
        ? documentModel.addIncenter(points[0].id, points[1].id, points[2].id, settings)
        : kind === "orthocenter"
          ? documentModel.addOrthocenter(points[0].id, points[1].id, points[2].id, settings)
          : documentModel.addIncircle(points[0].id, points[1].id, points[2].id, settings);
    if (created) selectOnly(created.id);
  });
  return Boolean(created);
}

function constructCircleFromSelection(throughThreePoints = false) {
  const selection = selectedObjects();
  const points = selection.filter((object) => object.type === "point");
  if (throughThreePoints) {
    if (points.length !== 3 || selection.length !== 3) return false;
    let created = null;
    mutate(() => {
      created = documentModel.addThreePointCircle(points[0].id, points[1].id, points[2].id, settings);
      selectOnly(created?.id || null);
    });
    return Boolean(created);
  }
  const segment = selection.find((object) => object.type === "segment");
  if (points.length === 1 && segment && selection.length === 2) {
    let created = null;
    mutate(() => {
      created = documentModel.addCircleWithSegmentRadius(points[0].id, segment.id, settings);
      selectOnly(created?.id || null);
    });
    return Boolean(created);
  }
  if (points.length === 2 && selection.length === 2) {
    let created = null;
    mutate(() => {
      created = documentModel.addCircle(points[0].id, points[1].id, settings);
      selectOnly(created?.id || null);
    });
    return Boolean(created);
  }
  return false;
}

function constructArcFromSelection(throughThreePoints = false) {
  const selection = selectedObjects();
  const points = selection.filter((object) => object.type === "point");
  if (throughThreePoints) {
    if (points.length !== 3 || selection.length !== 3) return false;
    const preview = documentModel.addThreePointArc(points[0].id, points[1].id, points[2].id, settings);
    const valid = preview && documentModel.getShapeGeometry(preview);
    if (preview) documentModel.removeWithDependents(preview.id);
    if (!valid) return false;
    mutate(() => {
      const created = documentModel.addThreePointArc(points[0].id, points[1].id, points[2].id, settings);
      selectOnly(created?.id || null);
    });
    return true;
  }
  const circle = selection.find((object) => documentModel.getShapeGeometry(object)?.kind === "circle");
  if (!circle || points.length !== 2 || selection.length !== 3) return false;
  let created = null;
  mutate(() => {
    created = documentModel.addArcOnCircle(circle.id, points[0].id, points[1].id, settings);
    selectOnly(created?.id || null);
  });
  return Boolean(created);
}

function constructInteriorsFromSelection(kind) {
  const selection = selectedObjects();
  if (kind === "circleInterior") {
    const circles = selection.filter((object) => documentModel.getShapeGeometry(object)?.kind === "circle");
    if (!circles.length || circles.length !== selection.length) return false;
    mutate(() => {
      const created = circles.map((circle) => documentModel.addCircleInterior(circle.id, settings)).filter(Boolean);
      setSelection(created.map((object) => object.id), created.at(-1)?.id || null);
    });
    return true;
  }
  const arcs = selection.filter((object) => documentModel.getShapeGeometry(object)?.kind === "arc");
  if (!arcs.length || arcs.length !== selection.length) return false;
  mutate(() => {
    const created = arcs.map((arc) => documentModel.addArcInterior(
      arc.id, kind === "segmentInterior" ? "segment" : "sector", settings,
    )).filter(Boolean);
    setSelection(created.map((object) => object.id), created.at(-1)?.id || null);
  });
  return true;
}

function constructLocusFromSelection() {
  const points = selectedObjects().filter((object) => object.type === "point");
  if (points.length !== 2 || selectedIds.size !== 2) return false;
  const driver = [...points].reverse().find((point) => point.definition.kind === "on-shape");
  const traced = driver && points.find((point) => point.id !== driver.id);
  if (!driver || !traced) return false;
  let created = null;
  mutate(() => {
    created = documentModel.addLocus(traced.id, driver.id, settings);
    selectOnly(created?.id || null);
  });
  return Boolean(created);
}

function runConstructionCommand(command) {
  const success = command === "segment" || command === "line" || command === "ray"
    ? constructLinearShapesFromSelection(command)
    : command === "midpoint" ? constructMidpointsFromSelection()
      : command === "intersection" ? constructIntersectionsFromSelection()
        : command === "perpendicularBisector" ? constructPerpendicularBisectorsFromSelection()
          : command === "parallel" || command === "perpendicular" ? constructDerivedLinesFromSelection(command)
            : command === "angleBisector" ? constructAngleBisectorFromSelection()
              : ["centroid", "incenter", "orthocenter", "incircle"].includes(command)
                ? constructTriangleObjectFromSelection(command)
                : command === "circle" ? constructCircleFromSelection(false)
                : command === "threePointCircle" ? constructCircleFromSelection(true)
                  : command === "arc" ? constructArcFromSelection(false)
                    : command === "threePointArc" ? constructArcFromSelection(true)
                      : ["circleInterior", "sectorInterior", "segmentInterior"].includes(command)
                        ? constructInteriorsFromSelection(command)
                        : command === "locus" ? constructLocusFromSelection() : false;
  if (!success) {
    const requirement = {
      segment: "请选择至少两个点", line: "请选择至少两个点", ray: "请选择至少两个点",
      midpoint: "请选择一条或多条线段", intersection: "请选择两个相交的线形或圆形对象",
      perpendicularBisector: "请选择一条或多条线段", parallel: "请至少选择一个点和一条基准线，可同时多选",
      perpendicular: "请至少选择一个点和一条基准线，可同时多选", angleBisector: "请按顺序选择边上点、顶点、边上点",
      centroid: "请选择三个不共线的三角形顶点", incenter: "请选择三个不共线的三角形顶点",
      orthocenter: "请选择三个不共线的三角形顶点", incircle: "请选择三个不共线的三角形顶点",
      circle: "请选择圆心与圆上一点，或一个点与一条半径线段", threePointCircle: "请选择三个不共线的点",
      arc: "请选择一个圆以及圆上的两个点", threePointArc: "请选择三个不共线的点",
      circleInterior: "请选择一个或多个圆", sectorInterior: "请选择一条或多条圆弧",
      segmentInterior: "请选择一条或多条圆弧", locus: "请选择被追踪点和一个路径约束点",
    }[command] || "请检查当前选择";
    showToast(requirement, "warning");
  }
}

function measurementPosition(index = 0) {
  const existing = documentModel.objects.filter((object) => object.type === "measurement").length;
  return { x: view.x + 22, y: view.y + 32 + (existing + index) * 25 };
}

function runMeasurementCommand(kind) {
  const selection = selectedObjects();
  const points = selection.filter((object) => object.type === "point");
  const segments = selection.filter((object) => object.type === "segment");
  const circles = selection.filter((object) => documentModel.getShapeGeometry(object)?.kind === "circle");
  const arcs = selection.filter((object) => documentModel.getShapeGeometry(object)?.kind === "arc");
  const lines = selection.filter((object) => documentModel.getShapeGeometry(object)?.kind === "line");
  const angleMarks = selection.filter((object) => object.type === "angleMark");
  let groups = [];
  if (kind === "distance" && points.length === 2 && selection.length === 2) groups = [[points[0].id, points[1].id]];
  else if (kind === "collinearity" && points.length === 3 && selection.length === 3) {
    groups = [[points[0].id, points[1].id, points[2].id]];
  }
  else if (kind === "length" && segments.length && segments.length === selection.length) groups = segments.map((segment) => [segment.id]);
  else if (kind === "arcLength" && arcs.length && arcs.length === selection.length) groups = arcs.map((arc) => [arc.id]);
  else if (kind === "ratio" && segments.length === 2 && selection.length === 2) groups = [[segments[0].id, segments[1].id]];
  else if (kind === "angle" && angleMarks.length && angleMarks.length === selection.length) {
    groups = angleMarks.map((mark) => [mark.id]);
  }
  else if (kind === "angle" && arcs.length && arcs.length === selection.length) {
    groups = arcs.map((arc) => [arc.id]);
  }
  else if (kind === "angle" && points.length === 3 && selection.length === 3) groups = [[points[0].id, points[1].id, points[2].id]];
  else if (kind === "angle" && lines.length === 2 && selection.length === 2) {
    const commonId = [lines[0].pointAId, lines[0].pointBId]
      .find((id) => id === lines[1].pointAId || id === lines[1].pointBId);
    const first = commonId ? otherDefiningPoint(lines[0], commonId) : null;
    const second = commonId ? otherDefiningPoint(lines[1], commonId) : null;
    if (commonId && first && second) groups = [[first, commonId, second]];
    else groups = [[lines[0].id, lines[1].id]];
  } else if (["radius", "circumference", "circleArea"].includes(kind) && circles.length && circles.length === selection.length) {
    groups = circles.map((circle) => [circle.id]);
  } else if (kind === "coordinates" && points.length && points.length === selection.length) {
    const system = activeCoordinateSystem();
    groups = points.map((point) => system ? [point.id, system.id] : [point.id]);
  } else if (kind === "pointValue" && points.length && points.length === selection.length && points.every((point) => point.definition.kind === "on-shape")) {
    groups = points.map((point) => [point.id]);
  }
  else if (kind === "slope" && lines.length && lines.length === selection.length) groups = lines.map((line) => [line.id]);
  if (!groups.length) {
    const requirement = {
      distance: "距离需要选择两个点", length: "长度需要选择一条或多条线段",
      arcLength: "弧长需要选择一条或多条圆弧", ratio: "比值需要选择两条线段",
      angle: "角度需要按顺序选择三个点、两条线、角标记或圆弧",
      collinearity: "共线误差需要选择三个点", radius: "半径需要选择一个或多个圆",
      circumference: "圆周长需要选择一个或多个圆", circleArea: "圆面积需要选择一个或多个圆",
      coordinates: "坐标需要选择一个或多个点", pointValue: "路径参数需要选择路径上的点",
      slope: "斜率需要选择一条或多条线",
    }[kind] || "当前选择无法完成该度量";
    showToast(requirement, "warning");
    return;
  }
  mutate(() => {
    const created = groups.map((parents, index) => documentModel.addMeasurement(
      kind, parents, measurementPosition(index), settings,
    )).filter(Boolean);
    setSelection(created.map((item) => item.id), created.at(-1)?.id || null);
  });
  showToast(`已创建 ${groups.length} 个动态度量值`);
}

function createTransformedObject(object, kind, value) {
  return object.type === "point"
    ? kind === "translate" ? documentModel.addTranslatedPoint(object.id, value.dx, value.dy, settings)
      : kind === "rotate" ? documentModel.addRotatedPoint(object.id, documentModel.markedCenterId, value, settings)
        : kind === "scale" ? documentModel.addScaledPoint(object.id, documentModel.markedCenterId, value, settings)
          : documentModel.addReflectedPoint(object.id, documentModel.markedMirrorId, settings)
    : documentModel.addTransformedShape(object.id, kind, value, settings);
}

function transformSelectedGeometry(kind, value = null, iterations = 1) {
  const selection = selectedObjects();
  const transformable = selection.filter((object) =>
    object.type === "point" || (documentModel.isShape(object.id) && object.type !== "coordinateSystem"));
  if (!transformable.length) return false;
  mutate(() => {
    let generation = transformable;
    const allCreated = [];
    for (let iteration = 0; iteration < Math.max(1, iterations); iteration += 1) {
      const nextGeneration = generation.map((object) => createTransformedObject(object, kind, value)).filter(Boolean);
      allCreated.push(...nextGeneration);
      generation = nextGeneration;
      if (!generation.length) break;
    }
    setSelection(generation.map((object) => object.id), generation.at(-1)?.id || allCreated.at(-1)?.id || null);
  });
  return true;
}

async function runTransformCommand(command) {
  const selection = selectedObjects();
  if (command === "iterate") {
    if (!lastTransform) { showToast("请先完成一次平移、旋转、缩放或反射"); return; }
    const count = Number(await askUser("重复次数（会保留每一代变换像）", "3", { title: "重复变换" }));
    if (!Number.isInteger(count) || count < 1 || count > 50) { showToast("重复次数应为 1～50 的整数"); return; }
    if (transformSelectedGeometry(lastTransform.kind, lastTransform.value, count)) showToast(`已生成 ${count} 代动态变换像`);
    else showToast("当前选择中没有可变换的对象");
    return;
  }
  if (command === "markCenter") {
    if (selection.length !== 1 || selection[0].type !== "point") {
      showToast("请选择一个点作为旋转和缩放中心");
      return;
    }
    mutate(() => documentModel.markTransformCenter(selection[0].id));
    showToast(`已标记点 ${selection[0].label} 为变换中心`);
    return;
  }
  if (command === "markMirror") {
    if (selection.length !== 1 || documentModel.getShapeGeometry(selection[0])?.kind !== "line") {
      showToast("请选择一条线作为反射镜面");
      return;
    }
    mutate(() => documentModel.markMirror(selection[0].id));
    showToast("已标记反射镜面");
    return;
  }
  let value = null;
  if (command === "translate") {
    const input = await askUser("输入平移量 dx, dy", "40, 0", { title: "平移" });
    if (input == null) return;
    const [dx, dy] = input.split(/[,，\s]+/).map(Number);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      showToast("平移量格式应为 dx, dy");
      return;
    }
    value = { dx, dy };
  } else if (command === "rotate") {
    if (!documentModel.markedCenterId) { showToast("请先选中一个点并标记变换中心"); return; }
    value = Number(await askUser("输入旋转角度（度，正值为顺时针）", "90", { title: "旋转" }));
    if (!Number.isFinite(value)) return;
  } else if (command === "scale") {
    if (!documentModel.markedCenterId) { showToast("请先选中一个点并标记变换中心"); return; }
    value = Number(await askUser("输入缩放比例", "2", { title: "缩放" }));
    if (!Number.isFinite(value) || Math.abs(value) <= 1e-9) { showToast("缩放比例必须是非零数值"); return; }
  } else if (command === "reflect") {
    if (!documentModel.markedMirrorId) { showToast("请先选中一条线并标记反射镜面"); return; }
  }
  if (!transformSelectedGeometry(command, value)) showToast("当前选择中没有可变换的几何对象");
  else {
    lastTransform = { kind: command, value: value && typeof value === "object" ? { ...value } : value };
    showToast("已创建动态变换像");
  }
}

function activeCoordinateSystem() {
  return selectedObjects().find((object) => object.type === "coordinateSystem") ||
    [...documentModel.objects].reverse().find((object) => object.type === "coordinateSystem" && !object.hidden) || null;
}

function parseRange(input, fallbackMin, fallbackMax) {
  const [minimum, maximum] = String(input ?? "").split(/[,，\s]+/).map(Number);
  return Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum
    ? { min: minimum, max: maximum }
    : { min: fallbackMin, max: fallbackMax };
}

async function runDataCommand(command) {
  const numericObjects = documentModel.objects.filter((object) =>
    ["parameter", "calculation", "measurement"].includes(object.type) && documentModel.getNumericValue(object) !== null);
  if (command === "animate") { await toggleAnimationForSelection(); return; }
  if (command === "table") {
    const sources = selectedObjects().filter((object) =>
      ["parameter", "calculation", "measurement"].includes(object.type) && documentModel.getNumericValue(object) !== null);
    if (!sources.length) { showToast("请先选择一个或多个参数、计算结果或度量值"); return; }
    let created = null;
    mutate(() => {
      created = documentModel.addTable(sources.map((object) => object.id), {
        x: view.x + view.width * 0.08, y: view.y + view.height * 0.18,
      }, settings);
      selectOnly(created?.id || null);
    });
    showToast(created ? "数据表格已创建" : "无法创建表格");
    return;
  }
  if (command === "collectTable") {
    const tables = selectedObjects().filter((object) => object.type === "table");
    if (!tables.length) { showToast("请先选择需要采集数据的表格"); return; }
    mutate(() => { for (const table of tables) documentModel.addTableRow(table.id); });
    showToast(`已向 ${tables.length} 个表格采集当前数值`);
    return;
  }
  if (command === "parameter") {
    const defaultName = `p${documentModel.objects.filter((object) => object.type === "parameter").length + 1}`;
    const name = await askUser("参数名称（英文字母开头）", defaultName, { title: "新建参数" });
    if (!name) return;
    const value = Number(await askUser("参数值", "1", { title: "新建参数" }));
    if (!Number.isFinite(value)) { showToast("参数值必须是数值"); return; }
    const unitInput = await askUser("单位：none / distance / angle", "none", { title: "新建参数" });
    if (unitInput == null) return;
    const unit = ["distance", "angle"].includes(unitInput.trim()) ? unitInput.trim() : "none";
    let created = null;
    mutate(() => {
      created = documentModel.addParameter(name, value, unit, {
        x: view.x + view.width * 0.06,
        y: view.y + view.height * (0.12 + numericObjects.length * 0.045),
      }, settings);
      selectOnly(created?.id || null);
    });
    showToast(created ? "参数已创建；双击参数可修改数值" : "参数名称无效或已无法计算");
    return;
  }
  if (command === "calculation") {
    const available = numericObjects.map((object) =>
      `${object.type === "measurement" ? object.id.replace("obj-", "m") : object.name}=${documentModel.getNumericValue(object)}`).join("，");
    const defaultName = `c${documentModel.objects.filter((object) => object.type === "calculation").length + 1}`;
    const name = await askUser("计算结果名称（英文字母开头）", defaultName, { title: "新建计算" });
    if (!name) return;
    const expression = await askUser(`输入表达式。可用：${available || "pi、e"}\n函数：sin cos tan sqrt abs ln log round trunc`, "2*pi", { title: "新建计算", multiline: true });
    if (!expression) return;
    const variables = {};
    for (const object of numericObjects) {
      const variable = object.type === "measurement" ? object.id.replace("obj-", "m") : object.name;
      variables[variable] = object.id;
    }
    let created = null;
    mutate(() => {
      created = documentModel.addCalculation(name, expression, variables, {
        x: view.x + view.width * 0.06,
        y: view.y + view.height * (0.12 + numericObjects.length * 0.045),
      }, settings);
      selectOnly(created?.id || null);
    });
    showToast(created ? "动态计算已创建" : "表达式无效，请检查变量名和括号");
    return;
  }
  if (command === "coordinateSystem") {
    const selectedPoint = selectedObjects().find((object) => object.type === "point");
    const unit = Number(await askUser("每个坐标单位对应多少画布像素", "50", { title: "新建坐标系" }));
    if (!Number.isFinite(unit) || unit < 10) { showToast("坐标单位至少为 10 像素"); return; }
    const gridType = await askUser("网格类型：square / rectangular / polar", "square", { title: "新建坐标系" });
    if (gridType == null) return;
    const showGrid = await confirmUser("是否显示覆盖整个画布的坐标网格？\n选择“取消”只显示坐标轴。", { title: "坐标网格", confirmLabel: "显示网格", cancelLabel: "只显示坐标轴" });
    let created = null;
    mutate(() => {
      const origin = selectedPoint?.id || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
      created = documentModel.addCoordinateSystem(origin, settings, { unitX: unit, unitY: unit, gridType, showGrid });
      selectOnly(created?.id || null);
    });
    showToast(created ? "坐标系已创建" : "无法创建坐标系");
    return;
  }
  const systemObject = activeCoordinateSystem();
  if (!systemObject) { showToast("请先通过“数据与绘图”创建坐标系"); return; }
  if (command === "toggleGrid") {
    mutate(() => { systemObject.showGrid = !systemObject.showGrid; selectOnly(systemObject.id); });
    showToast(systemObject.showGrid ? "已显示完整坐标网格" : "已隐藏坐标网格");
    return;
  }
  if (command === "plotPoint") {
    const input = await askUser("输入点的坐标表达式 x, y（可使用参数名称）", "1, 1", { title: "绘制点" });
    if (!input) return;
    const comma = Math.max(input.indexOf(","), input.indexOf("，"));
    if (comma < 0) { showToast("请用逗号分隔 x 和 y"); return; }
    const xExpression = input.slice(0, comma).trim();
    const yExpression = input.slice(comma + 1).trim();
    let created = null;
    mutate(() => {
      created = documentModel.addPlottedPoint(systemObject.id, xExpression, yExpression, settings);
      selectOnly(created?.id || null);
    });
    showToast(created ? "动态坐标点已创建" : "坐标表达式无效");
    return;
  }
  if (["functionGraph", "inverseGraph", "polarGraph", "derivative"].includes(command)) {
    const selectedFunction = selectedObjects().find((object) => object.type === "functionGraph");
    const promptText = command === "inverseGraph" ? "输入 x=f(y) 的表达式"
      : command === "polarGraph" ? "输入 r=f(theta) 的表达式"
        : command === "derivative" ? "输入需要求导并绘制的 f(x)" : "输入函数 f(x)";
    const defaultExpression = command === "inverseGraph" ? "y^2" : command === "polarGraph" ? "2+cos(5*theta)" : "sin(x)";
    const expression = command === "derivative" && selectedFunction
      ? selectedFunction.expression
      : await askUser(promptText, defaultExpression, { title: command === "derivative" ? "绘制导函数" : "绘制函数" });
    if (!expression) return;
    const fallback = command === "polarGraph" ? { min: 0, max: Math.PI * 2, text: "0, 6.283185" } : { min: -10, max: 10, text: "-10, 10" };
    const range = parseRange(await askUser(command === "polarGraph" ? "theta 范围最小值, 最大值" : "定义域最小值, 最大值", selectedFunction ? `${selectedFunction.min}, ${selectedFunction.max}` : fallback.text, { title: "函数定义域" }), fallback.min, fallback.max);
    let created = null;
    mutate(() => {
      created = documentModel.addFunctionGraph(systemObject.id, expression, settings, {
        ...range, derivative: command === "derivative",
        mode: command === "inverseGraph" ? "x" : command === "polarGraph" ? "polar" : "y",
        variables: command === "derivative" ? selectedFunction?.variables : undefined,
      });
      selectOnly(created?.id || null);
    });
    showToast(created ? (command === "derivative" ? "导函数图像已创建" : "函数图像已创建") : "函数表达式无效");
    return;
  }
  if (command === "parametricPlot") {
    const xExpression = await askUser("输入 x(t)", "3*cos(t)", { title: "参数曲线" });
    if (!xExpression) return;
    const yExpression = await askUser("输入 y(t)", "3*sin(t)", { title: "参数曲线" });
    if (!yExpression) return;
    const range = parseRange(await askUser("参数范围最小值, 最大值", "0, 2*pi", { title: "参数范围" }), 0, Math.PI * 2);
    let created = null;
    mutate(() => {
      created = documentModel.addParametricPlot(systemObject.id, xExpression, yExpression, settings, range);
      selectOnly(created?.id || null);
    });
    showToast(created ? "参数曲线已创建" : "参数曲线表达式无效");
  }
}

function undo() {
  if (cancelIncompleteConstruction()) {
    afterDocumentChange();
    return;
  }
  documentModel = history.undo(documentModel);
  clearSelection();
  pendingId = null;
  constructionPointIds = [];
  afterDocumentChange();
}

function redo() {
  if (cancelIncompleteConstruction()) {
    afterDocumentChange();
    return;
  }
  documentModel = history.redo(documentModel);
  clearSelection();
  pendingId = null;
  constructionPointIds = [];
  afterDocumentChange();
}

function resetView() {
  const rect = elements.geometryCanvas.getBoundingClientRect();
  const compactLayout = document.documentElement.dataset.device !== "desktop";
  const width = compactLayout && rect.width > 0
    ? Math.max(420, Math.min(1200, rect.width * 1.25))
    : 1200;
  const height = rect.width > 0 ? width * rect.height / rect.width : 720;
  const center = { x: 600, y: 360 };
  canvasAspect = rect.width > 0 ? rect.height / rect.width : height / width;
  canvasPixelWidth = rect.width > 0 ? rect.width : null;
  canvasLayoutOrientation = document.documentElement.dataset.orientation || null;
  view = compactLayout
    ? { x: center.x - width / 2, y: center.y - height / 2, width, height }
    : { x: 0, y: 0, width, height };
  updateViewBox();
  render();
}

function syncSettingsControls() {
  elements.pointSize.value = settings.pointSize;
  elements.pointSizeValue.value = settings.pointSize;
  elements.pointColor.value = settings.pointColor;
  elements.pointColorValue.value = settings.pointColor.toUpperCase();
  elements.showLabels.checked = settings.showLabels;
  elements.lineWidth.value = settings.lineWidth;
  elements.lineWidthValue.value = settings.lineWidth;
  elements.lineColor.value = settings.lineColor;
  elements.lineColorValue.value = settings.lineColor.toUpperCase();
  elements.lineDash.value = settings.lineDash;
  elements.snapToggle.checked = settings.snapToGrid;
  elements.gridSize.value = settings.gridSize;
}

function syncInspectorControls(selection = selectedObjects()) {
  syncSettingsControls();
  const isEditingSelectedPointName = document.activeElement === elements.pointName
    && pointNameEditPointId && selection.length === 1 && selection[0].id === pointNameEditPointId;
  if (!isEditingSelectedPointName) {
    elements.pointName.disabled = true;
    elements.pointName.value = "";
  }
  elements.angleMarkSizeRow.hidden = true;
  elements.angleMarkOpacityRow.hidden = true;
  elements.angleMarkDirectionRow.hidden = true;
  elements.angleMarkReverse.hidden = true;
  elements.pathMarkKindRow.hidden = true;
  const points = selection.filter((object) => object.type === "point");
  const shapes = selection.filter((object) => documentModel.isShape(object.id));
  const coloredObjects = selection.filter((object) => object.type !== "point" && object.type !== "image");
  const hasSelection = selection.length > 0;
  for (const control of [elements.pointSize, elements.pointColor, elements.showLabels]) {
    control.disabled = hasSelection && points.length === 0;
  }
  for (const control of [elements.lineWidth, elements.lineDash]) {
    control.disabled = hasSelection && shapes.length === 0;
  }
  elements.lineColor.disabled = hasSelection && coloredObjects.length === 0;
  elements.showLabelsText.textContent = points.length ? "显示点标签" : "默认显示点标签";

  const commonValue = (objects, getter) => {
    if (!objects.length) return null;
    const values = objects.map(getter);
    return values.every((value) => value === values[0]) ? values[0] : null;
  };
  const pointRadius = commonValue(points, (point) => point.style?.radius ?? settings.pointSize);
  const pointColor = commonValue(points, (point) => point.style?.color ?? settings.pointColor);
  if (pointRadius !== null) elements.pointSize.value = elements.pointSizeValue.value = pointRadius;
  if (pointColor !== null) {
    elements.pointColor.value = pointColor;
    elements.pointColorValue.value = pointColor.toUpperCase();
  }
  if (points.length) elements.showLabels.checked = points.every((point) => point.style?.showLabel !== false);
  const lineWidth = commonValue(shapes, (shape) => shape.style?.width ?? settings.lineWidth);
  const lineDash = commonValue(shapes, (shape) => shape.style?.dash ?? settings.lineDash);
  const lineColor = commonValue(coloredObjects, (object) => object.style?.color ?? settings.lineColor);
  if (lineWidth !== null) elements.lineWidth.value = elements.lineWidthValue.value = lineWidth;
  if (lineDash !== null) elements.lineDash.value = lineDash;
  if (lineColor !== null) {
    elements.lineColor.value = lineColor;
    elements.lineColorValue.value = lineColor.toUpperCase();
  }

  if (selection.length !== 1) return;
  const object = selection[0];
  if (object.type === "point") {
    elements.pointName.disabled = false;
    if (!isEditingSelectedPointName || pointNameEditPointId !== object.id) elements.pointName.value = object.label;
  } else {
    if (object.type === "angleMark") {
      elements.angleMarkSizeRow.hidden = false;
      elements.angleMarkOpacityRow.hidden = false;
      elements.angleMarkDirectionRow.hidden = false;
      elements.angleMarkReverse.hidden = false;
      elements.angleMarkSize.value = Number(object.radius) || 24;
      elements.angleMarkSizeValue.value = Number(object.radius) || 24;
      elements.angleMarkOpacity.value = Number.isFinite(object.opacity) ? object.opacity : 0.25;
      elements.angleMarkOpacityValue.value = Number.isFinite(object.opacity) ? object.opacity : 0.25;
      elements.angleMarkShowDirection.checked = object.showDirection === true;
    }
    if (object.type === "pathMark") {
      elements.pathMarkKindRow.hidden = false;
      elements.pathMarkKind.value = object.markKind === "arrow" ? "arrow" : "tick";
    }
  }
}

function readSettingsControls(event) {
  const pointStyleControls = new Set(["pointSize", "pointColor", "showLabels"]);
  const shapeStyleControls = new Set(["lineWidth", "lineColor", "lineDash"]);
  const controlId = event?.target?.id;
  const isStyleControl = pointStyleControls.has(controlId) || shapeStyleControls.has(controlId);
  const selection = selectedObjects();
  if (isStyleControl && selection.length) {
    const targets = selection.filter((object) => {
      if (pointStyleControls.has(controlId)) return object.type === "point";
      if (controlId === "lineColor") return object.type !== "point" && object.type !== "image";
      return documentModel.isShape(object.id);
    });
    if (!targets.length) { render(); return; }
    if (!styleEditSnapshot) styleEditSnapshot = documentModel.serialize();
    const patch = controlId === "pointSize" ? { radius: Number(elements.pointSize.value) }
      : controlId === "pointColor" ? { color: elements.pointColor.value }
        : controlId === "showLabels" ? { showLabel: elements.showLabels.checked }
          : controlId === "lineWidth" ? { width: Number(elements.lineWidth.value) }
            : controlId === "lineColor" ? { color: elements.lineColor.value }
              : { dash: elements.lineDash.value };
    for (const object of targets) documentModel.applyStylePatch(object.id, patch);
    autosave();
    if (event?.type === "change" && styleEditSnapshot) {
      if (styleEditSnapshot !== documentModel.serialize()) history.recordSnapshot(styleEditSnapshot);
      styleEditSnapshot = null;
    }
    render();
    return;
  }

  const settingPatch = controlId === "pointSize" ? { pointSize: Number(elements.pointSize.value) }
    : controlId === "pointColor" ? { pointColor: elements.pointColor.value }
      : controlId === "showLabels" ? { showLabels: elements.showLabels.checked }
        : controlId === "lineWidth" ? { lineWidth: Number(elements.lineWidth.value) }
          : controlId === "lineColor" ? { lineColor: elements.lineColor.value }
            : controlId === "lineDash" ? { lineDash: elements.lineDash.value }
              : controlId === "snapToggle" ? { snapToGrid: elements.snapToggle.checked }
                : controlId === "gridSize" ? { gridSize: Math.max(5, Number(elements.gridSize.value) || 20) }
                  : null;
  if (settingPatch) {
    settings = { ...settings, ...settingPatch };
    saveSettings();
  }
  render();
}

function applyStyleToSelection() {
  if (!selectedIds.size) return;
  mutate(() => {
    for (const id of selectedIds) documentModel.applyStyle(id, settings);
  });
}

async function copyTextToClipboard(text) {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("浏览器未允许直接写入剪贴板，将尝试兼容复制。", error);
  }
  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");
  let copied = false;
  try {
    textarea.value = text;
    textarea.readOnly = true;
    textarea.tabIndex = -1;
    textarea.setAttribute("aria-hidden", "true");
    Object.assign(textarea.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      opacity: "0",
    });
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand("copy");
  } catch (error) {
    console.warn("兼容剪贴板复制失败，将显示手动复制窗口。", error);
  } finally {
    textarea.remove();
    try {
      if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
    } catch {}
  }
  return copied;
}

async function copyCurrentViewLatex() {
  try {
    const result = createTikzExport(documentModel, {
      view,
      canvasWidthPx: elements.geometryCanvas.getBoundingClientRect().width,
      pointLabelFontSize: settings.pointLabelFontSize,
    });
    if (!result.exportedCount) {
      showToast("当前视图没有可导出的可见对象", "warning");
      return;
    }
    if (!await copyTextToClipboard(result.code)) {
      await askUser("浏览器未允许自动复制；代码已选中，请按 Ctrl+C 手动复制。", result.code, {
        title: "复制 LaTeX/TikZ 代码",
        multiline: true,
        rows: 12,
        confirmLabel: "关闭",
        cancelLabel: "关闭",
      });
      return;
    }
    const skipped = result.warnings.length
      ? "；另有 " + result.warnings.length + " 项图片、交互或无效内容未包含"
      : "";
    showToast("已复制 " + result.exportedCount + " 个可见对象的 LaTeX/TikZ 代码" + skipped);
  } catch (error) {
    console.error("生成 LaTeX/TikZ 代码失败。", error);
    showToast("生成 LaTeX/TikZ 代码失败，请检查当前画板", "error");
  }
}

function downloadFallback(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportFileResult(message, isError = false) {
  elements.saveState.textContent = message;
  elements.saveState.title = message;
  elements.saveState.classList.toggle("error", isError);
  showToast(message);
}

async function chooseSaveHandle(name, type, extension, description) {
  if (typeof window.showSaveFilePicker !== "function") return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description, accept: { [type]: [extension] } }],
    });
  } catch (error) {
    if (error?.name === "AbortError") return false;
    console.warn("无法打开另存为窗口，将改用浏览器下载。", error);
    return null;
  }
}

function safeFileName() {
  return (documentModel.title || "未命名画板").replace(/[\\/:*?"<>|]/g, "_");
}

function createProjectBlob() {
  documentModel.title = elements.documentTitle.value.trim() || "未命名画板";
  for (const page of projectPages) page.document.title = documentModel.title;
  projectPages[activePageIndex].document = documentModel.toJSON();
  const project = {
    format: "SketchpadNext",
    projectVersion: 1,
    activePageIndex,
    pages: projectPages,
  };
  return new Blob([JSON.stringify(project, null, 2)], { type: "application/x-sketchpadnext+json" });
}

async function saveDocument({ saveAs = false } = {}) {
  await projectHandleRestorePromise;
  const blob = createProjectBlob();
  const name = `${safeFileName()}.spn`;
  let handle = saveAs ? null : currentProjectHandle;
  if (!handle) {
    handle = await chooseSaveHandle(name, "application/x-sketchpadnext+json", ".spn", "SketchpadNext 可编辑工程");
    if (handle === false) {
      reportFileResult("已取消保存");
      return false;
    }
  }
  if (!handle) {
    downloadFallback(name, blob);
    reportFileResult(`浏览器不支持直接写回，已下载：${name}`);
    return true;
  }
  try {
    if (typeof handle.queryPermission === "function") {
      let permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission === "prompt" && typeof handle.requestPermission === "function") {
        permission = await handle.requestPermission({ mode: "readwrite" });
      }
      if (permission !== "granted") {
        reportFileResult("未获得文件修改权限，工程未保存", true);
        return false;
      }
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    currentProjectHandle = handle;
    await rememberProjectHandle(handle);
    reportFileResult(`已保存：${handle.name}`);
    return true;
  } catch (error) {
    console.error("写入工程文件失败。", error);
    reportFileResult(`无法写入 ${handle.name || "当前工程"}，请使用“另存为”`, true);
    return false;
  }
}

function saveDocumentAs() {
  return saveDocument({ saveAs: true });
}

async function openProjectFile(file, handle = null) {
  const parsed = JSON.parse(await file.text());
  cancelIncompleteConstruction();
  interactionEpoch += 1;
  if (parsed.projectVersion === 1 && Array.isArray(parsed.pages) && parsed.pages.length) {
    projectPages = parsed.pages.map((page, index) => ({
      name: String(page.name || `页面 ${index + 1}`),
      document: GeometryDocument.fromJSON(page.document).toJSON(),
    }));
    activePageIndex = Math.max(0, Math.min(projectPages.length - 1, Number(parsed.activePageIndex) || 0));
    documentModel = GeometryDocument.fromJSON(projectPages[activePageIndex].document);
  } else {
    documentModel = GeometryDocument.fromJSON(parsed);
    projectPages = [{ name: "页面 1", document: documentModel.toJSON() }];
    activePageIndex = 0;
  }
  currentProjectHandle = handle && file.name.toLowerCase().endsWith(".spn") ? handle : null;
  if (currentProjectHandle) await rememberProjectHandle(currentProjectHandle);
  else await forgetProjectHandle();
  history.clear();
  clearSelection();
  pendingId = null;
  constructionPointIds = [];
  constructionStartSnapshot = null;
  traceHistory.clear();
  stopAllAnimations();
  elements.documentTitle.value = documentModel.title;
  afterDocumentChange();
  showToast(currentProjectHandle ? `已打开：${file.name}` : "画板已打开；首次保存时请选择 .spn 文件位置");
}

async function openProject() {
  if (typeof window.showOpenFilePicker !== "function") {
    elements.fileInput.click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "SketchpadNext 可编辑工程",
        accept: {
          "application/x-sketchpadnext+json": [".spn"],
          "application/json": [".json"],
        },
      }],
    });
    const handle = handles[0];
    if (!handle) return;
    await openProjectFile(await handle.getFile(), handle);
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("无法打开工程。", error);
    showToast(error.message || "无法打开该文件");
  }
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add("visible");
  const duration = ["error", "warning"].includes(type) ? 4200 : 2200;
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), duration);
}

function objectReference(object) {
  if (!object) return "未知对象";
  return object.type === "point" ? `点 ${object.label}` : `${objectDescription(object)} (${object.id})`;
}

function showObjectInformation(object, persistent = false) {
  clearTimeout(infoTimer);
  const parents = documentModel.dependenciesOf(object)
    .map((id) => objectReference(documentModel.getObject(id)));
  const children = documentModel.objects
    .filter((candidate) => documentModel.dependenciesOf(candidate).includes(object.id))
    .map(objectReference);
  const geometry = object.type === "point"
    ? documentModel.getPointPosition(object)
    : documentModel.getShapeGeometry(object);
  let detail = "";
  if (object.type === "point" && geometry) detail = `\n位置：(${geometry.x.toFixed(2)}, ${geometry.y.toFixed(2)})`;
  else if (geometry?.kind === "circle") detail = `\n半径：${geometry.radius.toFixed(2)}`;
  else if (geometry?.kind === "angleMark") detail = `\n角度：${(geometry.signedAngle * 180 / Math.PI).toFixed(2)}°`;
  elements.infoPanel.textContent = [
    objectReference(object) + detail,
    `父对象：${parents.length ? parents.join("、") : "无（自由对象）"}`,
    `子对象：${children.length ? children.join("、") : "无"}`,
    persistent ? "按住 Shift：信息保持显示" : "信息将在数秒后自动隐藏",
  ].join("\n");
  elements.infoPanel.hidden = false;
  if (!persistent) infoTimer = setTimeout(() => { elements.infoPanel.hidden = true; }, 4500);
}

function handleKeyDown(event) {
  if (!elements.inputDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      finishDialog(null);
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.shiftKey ? saveDocumentAs() : saveDocument();
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    spacePanActive = true;
    elements.geometryCanvas.classList.add("pan-ready");
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    if (selectedIds.size) {
      objectClipboard = { document: documentModel.serialize(), ids: [...selectedIds] };
      pasteCount = 0;
      showToast(`已复制 ${selectedIds.size} 个对象及其构造依赖`);
    }
    event.preventDefault(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    if (objectClipboard) {
      pasteCount += 1;
      mutate(() => {
        const source = GeometryDocument.fromJSON(objectClipboard.document);
        const created = documentModel.importObjects(source, objectClipboard.ids, { x: 24 * pasteCount, y: 24 * pasteCount });
        setSelection(created.map((object) => object.id), created.at(-1)?.id || null);
      });
      showToast("已粘贴并重建动态依赖");
    }
    event.preventDefault(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    if (selectedIds.size) {
      mutate(() => {
        const created = documentModel.duplicateObjects([...selectedIds]);
        setSelection(created.map((object) => object.id), created.at(-1)?.id || null);
      });
      showToast("已原位复制选中对象");
    }
    event.preventDefault(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault(); selectAllForCurrentTool(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
    event.preventDefault(); event.shiftKey ? showAllHidden() : hideSelection(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); toggleSelectedPointLabels(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault(); runDataCommand("parameter"); return;
  }
  if (event.altKey && event.key === "=") {
    event.preventDefault(); runDataCommand("calculation"); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault(); runDataCommand("functionGraph"); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "m") {
    if (constructMidpointsFromSelection()) event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    if (constructSegmentsFromSelection()) event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i") {
    if (constructIntersectionsFromSelection()) event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault(); redo(); return;
  }
  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); return; }
  if (event.key === "Escape") {
    event.preventDefault();
    if (cancelIncompleteConstruction()) {
      afterDocumentChange();
      showToast("已取消当前步骤");
    } else if (selectedIds.size) {
      clearSelection();
      render();
    } else if (currentTool !== "select") setTool("select");
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (!settings.shortcutsEnabled) return;
    const shortcut = {
      v: "select", p: "point", s: "segment", l: "line", y: "ray", m: "midpoint",
      n: "perpendicularBisector", r: "parallel", t: "perpendicular", b: "angleBisector",
      k: "marker", i: "info", x: "text", c: "circle", o: "threePointCircle",
    }[event.key.toLowerCase()];
    if (shortcut) {
      event.preventDefault();
      activateTool(shortcut);
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
}

function handleKeyUp(event) {
  if (event.code !== "Space") return;
  spacePanActive = false;
  elements.geometryCanvas.classList.remove("pan-ready");
}

async function runMenuCommand(menu, runner) {
  const command = menu.value;
  const label = menu.selectedOptions[0]?.textContent || "命令";
  menu.value = "";
  if (!command) return;
  try {
    await runner(command);
  } catch (error) {
    console.error(`${label}执行失败。`, error);
    showToast(`${label}未完成，请检查当前选择后重试`, "error");
  }
}

appShell?.addEventListener("pointerdown", (event) => {
  if (elements.geometryCanvas.contains(event.target)) return;
  if (cancelIncompleteConstruction()) afterDocumentChange();
}, true);
document.querySelectorAll(".tool-button[data-tool]").forEach((button) => button.addEventListener("click", () => activateTool(button.dataset.tool)));
elements.geometryCanvas.addEventListener("pointerdown", handlePointerDown);
elements.geometryCanvas.addEventListener("pointermove", handlePointerMove);
elements.geometryCanvas.addEventListener("pointerup", handlePointerUp);
elements.geometryCanvas.addEventListener("pointercancel", handlePointerUp);
elements.geometryCanvas.addEventListener("lostpointercapture", handleLostPointerCapture);
elements.geometryCanvas.addEventListener("dblclick", handleDoubleClick);
elements.geometryCanvas.addEventListener("wheel", handleWheel, { passive: false });
elements.geometryCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener(PREFERENCES_CHANGE_EVENT, (event) => {
  settings = normalizePreferences(event.detail);
  syncSettingsControls();
  render();
});
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", () => {
  spacePanActive = false;
  elements.geometryCanvas.classList.remove("pan-ready");
  if (cancelIncompleteConstruction()) afterDocumentChange();
});
new ResizeObserver(() => {
  const rect = elements.geometryCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const nextAspect = rect.height / rect.width;
  const nextOrientation = document.documentElement.dataset.orientation
    || (rect.width >= rect.height ? "landscape" : "portrait");
  const compactLayout = document.documentElement.dataset.device !== "desktop";
  const orientationChanged = canvasLayoutOrientation !== null
    && nextOrientation !== canvasLayoutOrientation;
  const nextWidth = compactLayout && orientationChanged && canvasPixelWidth > 0
    ? Math.max(360, Math.min(1600, view.width * rect.width / canvasPixelWidth))
    : view.width;
  const aspectChanged = canvasAspect === null || Math.abs(nextAspect - canvasAspect) >= 0.001;
  const widthChanged = Math.abs(nextWidth - view.width) >= 0.001;
  canvasPixelWidth = rect.width;
  canvasLayoutOrientation = nextOrientation;
  if (!aspectChanged && !widthChanged) return;
  const centerX = view.x + view.width / 2;
  const centerY = view.y + view.height / 2;
  canvasAspect = nextAspect;
  view.width = nextWidth;
  view.height = view.width * nextAspect;
  view.x = centerX - view.width / 2;
  view.y = centerY - view.height / 2;
  if (touchGesture?.phase === "pinch") {
    const first = activeTouchPoints.get(touchGesture.pointerIds[0]);
    const second = activeTouchPoints.get(touchGesture.pointerIds[1]);
    if (first && second) {
      const metrics = touchPairMetrics(first, second);
      touchGesture.startView = { ...view };
      touchGesture.startCentroid = metrics.centroid;
      touchGesture.startDistance = Math.max(4, metrics.distance);
    }
  } else if (touchGesture?.phase === "pan") {
    const pointer = activeTouchPoints.get(touchGesture.pointerIds[0]);
    if (pointer) {
      touchGesture.startView = { ...view };
      touchGesture.startPoint = touchPoint(pointer);
    }
  }
  render();
}).observe(elements.geometryCanvas);

elements.undoButton.addEventListener("click", undo);
elements.redoButton.addEventListener("click", redo);
elements.constructionMenu.addEventListener("change", () => runMenuCommand(elements.constructionMenu, runConstructionCommand));
elements.measurementMenu.addEventListener("change", () => runMenuCommand(elements.measurementMenu, runMeasurementCommand));
elements.transformMenu.addEventListener("change", () => runMenuCommand(elements.transformMenu, runTransformCommand));
elements.dataMenu.addEventListener("change", () => runMenuCommand(elements.dataMenu, runDataCommand));
elements.displayMenu.addEventListener("change", () => runMenuCommand(elements.displayMenu, runDisplayCommand));
elements.deleteButton.addEventListener("click", deleteSelection);
elements.resetViewButton.addEventListener("click", () => {
  cancelIncompleteConstruction();
  resetView();
});
elements.saveButton.addEventListener("click", () => saveDocument());
elements.saveAsButton.addEventListener("click", saveDocumentAs);
elements.copyLatexButton.addEventListener("click", copyCurrentViewLatex);
elements.showHiddenButton.addEventListener("click", showAllHidden);
elements.openButton.addEventListener("click", openProject);
elements.insertImageButton.addEventListener("click", () => elements.imageInput.click());
elements.imageInput.addEventListener("change", async () => {
  const file = elements.imageInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取图片"));
      reader.readAsDataURL(file);
    });
    const size = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("图片格式无法解析"));
      image.src = dataUrl;
    });
    let created = null;
    mutate(() => {
      created = documentModel.addImage(dataUrl, { x: view.x + view.width * 0.15, y: view.y + view.height * 0.15 }, size);
      selectOnly(created?.id || null);
    });
    showToast(created ? "图片已插入，可用选择工具拖动" : "无法插入图片");
  } catch (error) { showToast(error.message || "无法插入图片"); }
  finally { elements.imageInput.value = ""; }
});
elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  try {
    await openProjectFile(file);
  } catch (error) {
    showToast(error.message || "无法打开该文件");
  } finally {
    elements.fileInput.value = "";
  }
});
elements.newButton.addEventListener("click", async () => {
  const hasProjectContent = projectPages.some((page, index) =>
    (index === activePageIndex ? documentModel.objects : page.document?.objects)?.length,
  );
  if (hasProjectContent && !await confirmUser("新建画板会清空所有页面中的内容，确定继续吗？", { title: "新建画板", confirmLabel: "清空并新建" })) return;
  cancelIncompleteConstruction();
  interactionEpoch += 1;
  documentModel = new GeometryDocument();
  currentProjectHandle = null;
  await forgetProjectHandle();
  projectPages = [{ name: "页面 1", document: documentModel.toJSON() }];
  activePageIndex = 0;
  history.clear();
  clearSelection();
  traceHistory.clear();
  stopAllAnimations();
  pendingId = null;
  constructionPointIds = [];
  constructionStartSnapshot = null;
  elements.documentTitle.value = documentModel.title;
  resetView();
  afterDocumentChange();
});
elements.documentTitle.addEventListener("change", () => {
  documentModel.title = elements.documentTitle.value.trim() || "未命名画板";
  for (const page of projectPages) page.document.title = documentModel.title;
  autosave();
});
elements.pageSelect.addEventListener("change", () => loadPage(Number(elements.pageSelect.value)));
elements.addPageButton.addEventListener("click", async () => {
  const name = await askUser("页面名称", `页面 ${projectPages.length + 1}`, { title: "新建页面" });
  if (!name?.trim()) return;
  cancelIncompleteConstruction();
  projectPages[activePageIndex].document = documentModel.toJSON();
  const pageDocument = new GeometryDocument();
  pageDocument.title = documentModel.title;
  projectPages.push({ name: name.trim().slice(0, 30), document: pageDocument.toJSON() });
  const nextIndex = projectPages.length - 1;
  loadPage(nextIndex);
  showToast("新页面已创建");
});
elements.renamePageButton.addEventListener("click", async () => {
  const current = projectPages[activePageIndex];
  const name = await askUser("页面名称", current.name, { title: "重命名页面" });
  if (!name?.trim()) return;
  current.name = name.trim().slice(0, 30);
  autosave(); render();
});
elements.deletePageButton.addEventListener("click", async () => {
  if (projectPages.length <= 1) return;
  if (!await confirmUser(`确定删除“${projectPages[activePageIndex].name}”吗？`, { title: "删除页面", confirmLabel: "删除" })) return;
  cancelIncompleteConstruction();
  interactionEpoch += 1;
  projectPages.splice(activePageIndex, 1);
  activePageIndex = Math.min(activePageIndex, projectPages.length - 1);
  documentModel = GeometryDocument.fromJSON(projectPages[activePageIndex].document);
  history.clear(); clearSelection(); traceHistory.clear(); stopAllAnimations(); resetView(); autosave(); render();
  showToast("页面已删除");
});

for (const control of [elements.pointSize, elements.pointColor, elements.showLabels, elements.lineWidth, elements.lineColor, elements.lineDash, elements.snapToggle, elements.gridSize]) {
  control.addEventListener("input", readSettingsControls);
  control.addEventListener("change", readSettingsControls);
}

function commitPointNameEdit() {
  const pointId = pointNameEditPointId;
  const snapshot = pointNameEditSnapshot;
  const originalLabel = pointNameEditOriginalLabel;
  pointNameEditPointId = null;
  pointNameEditSnapshot = null;
  pointNameEditOriginalLabel = "";
  if (!pointId) return;
  const point = documentModel.getObject(pointId);
  if (!point || point.type !== "point") { render(); return; }
  const label = elements.pointName.value.trim().slice(0, 12);
  if (!label) {
    elements.pointName.value = originalLabel || point.label;
    showToast("点名称不能为空，已保留原名称", "warning");
    render();
    return;
  }
  if (label === point.label) { render(); return; }
  if (!documentModel.renamePoint(point.id, label)) { render(); return; }
  if (snapshot && snapshot !== documentModel.serialize()) history.recordSnapshot(snapshot);
  afterDocumentChange();
}

elements.pointName.addEventListener("focus", () => {
  const point = selectedId ? documentModel.getObject(selectedId) : null;
  if (point?.type === "point") {
    pointNameEditSnapshot = documentModel.serialize();
    pointNameEditPointId = point.id;
    pointNameEditOriginalLabel = point.label;
  }
});
elements.pointName.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    elements.pointName.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    elements.pointName.value = pointNameEditOriginalLabel;
    pointNameEditPointId = null;
    pointNameEditSnapshot = null;
    pointNameEditOriginalLabel = "";
    elements.pointName.blur();
    render();
  }
});
elements.pointName.addEventListener("blur", commitPointNameEdit);
elements.angleMarkSize.addEventListener("pointerdown", () => {
  if (selectedId && documentModel.getObject(selectedId)?.type === "angleMark") {
    angleMarkSizeEditSnapshot = documentModel.serialize();
  }
});
elements.angleMarkSize.addEventListener("input", () => {
  const mark = selectedId ? documentModel.getObject(selectedId) : null;
  if (!mark || mark.type !== "angleMark") return;
  if (!angleMarkSizeEditSnapshot) angleMarkSizeEditSnapshot = documentModel.serialize();
  documentModel.setAngleMarkRadius(mark.id, elements.angleMarkSize.value);
  elements.angleMarkSizeValue.value = elements.angleMarkSize.value;
  autosave();
  render();
});
elements.angleMarkSize.addEventListener("change", () => {
  if (angleMarkSizeEditSnapshot && angleMarkSizeEditSnapshot !== documentModel.serialize()) {
    history.recordSnapshot(angleMarkSizeEditSnapshot);
  }
  angleMarkSizeEditSnapshot = null;
  render();
});
elements.angleMarkOpacity.addEventListener("pointerdown", () => {
  if (selectedId && documentModel.getObject(selectedId)?.type === "angleMark") {
    angleMarkSizeEditSnapshot = documentModel.serialize();
  }
});
elements.angleMarkOpacity.addEventListener("input", () => {
  const mark = selectedId ? documentModel.getObject(selectedId) : null;
  if (!mark || mark.type !== "angleMark") return;
  if (!angleMarkSizeEditSnapshot) angleMarkSizeEditSnapshot = documentModel.serialize();
  documentModel.setAngleMarkOpacity(mark.id, elements.angleMarkOpacity.value);
  elements.angleMarkOpacityValue.value = elements.angleMarkOpacity.value;
  autosave(); render();
});
elements.angleMarkOpacity.addEventListener("change", () => {
  if (angleMarkSizeEditSnapshot && angleMarkSizeEditSnapshot !== documentModel.serialize()) {
    history.recordSnapshot(angleMarkSizeEditSnapshot);
  }
  angleMarkSizeEditSnapshot = null;
  render();
});
elements.angleMarkShowDirection.addEventListener("change", () => {
  const mark = selectedId ? documentModel.getObject(selectedId) : null;
  if (mark?.type === "angleMark") mutate(() => documentModel.setAngleMarkDirectionVisible(mark.id, elements.angleMarkShowDirection.checked));
});
elements.angleMarkReverse.addEventListener("click", () => {
  const mark = selectedId ? documentModel.getObject(selectedId) : null;
  if (mark?.type === "angleMark") mutate(() => documentModel.reverseAngleMark(mark.id));
});
elements.pathMarkKind.addEventListener("change", () => {
  const mark = selectedId ? documentModel.getObject(selectedId) : null;
  if (!mark || mark.type !== "pathMark") return;
  mutate(() => documentModel.setPathMarkKind(mark.id, elements.pathMarkKind.value));
});
elements.applyStyleButton.addEventListener("click", applyStyleToSelection);
elements.batchRenameButton.addEventListener("click", batchRenameSelectedPoints);
elements.inputDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  finishDialog(elements.inputDialogValue.hidden ? true : elements.inputDialogValue.value);
});
elements.inputDialogCancel.addEventListener("click", () => finishDialog(null));
elements.inputDialog.addEventListener("pointerdown", (event) => {
  if (event.target === elements.inputDialog) finishDialog(null);
});
elements.inputDialogValue.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); finishDialog(null); }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault(); finishDialog(elements.inputDialogValue.value);
  }
});

elements.documentTitle.value = documentModel.title;
syncSettingsControls();
resetView();
setTool("select");
render();
