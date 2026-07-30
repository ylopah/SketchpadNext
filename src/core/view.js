function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function clientPointToWorld(view, rect, point) {
  const width = Math.max(1, finite(rect?.width, 1));
  const height = Math.max(1, finite(rect?.height, 1));
  return {
    x: finite(view?.x) + (finite(point?.x) - finite(rect?.left)) / width * finite(view?.width, 1),
    y: finite(view?.y) + (finite(point?.y) - finite(rect?.top)) / height * finite(view?.height, 1),
  };
}

export function fitViewToGesture(
  startView,
  rect,
  startCentroid,
  startDistance,
  currentCentroid,
  currentDistance,
  limits = {},
) {
  const rectWidth = Math.max(1, finite(rect?.width, 1));
  const rectHeight = Math.max(1, finite(rect?.height, 1));
  const minimumWidth = Math.max(1, finite(limits.minWidth, 180));
  const maximumWidth = Math.max(minimumWidth, finite(limits.maxWidth, 8000));
  const safeStartDistance = Math.max(1e-6, Math.abs(finite(startDistance, 1)));
  const safeCurrentDistance = Math.max(1e-6, Math.abs(finite(currentDistance, safeStartDistance)));
  const nextWidth = clamp(
    finite(startView?.width, 1200) * safeStartDistance / safeCurrentDistance,
    minimumWidth,
    maximumWidth,
  );
  const nextHeight = nextWidth * rectHeight / rectWidth;
  const anchor = clientPointToWorld(startView, rect, startCentroid);
  const relativeX = (finite(currentCentroid?.x) - finite(rect?.left)) / rectWidth;
  const relativeY = (finite(currentCentroid?.y) - finite(rect?.top)) / rectHeight;
  return {
    x: anchor.x - relativeX * nextWidth,
    y: anchor.y - relativeY * nextHeight,
    width: nextWidth,
    height: nextHeight,
  };
}

export function panViewFromClientDelta(startView, rect, startPoint, currentPoint) {
  const rectWidth = Math.max(1, finite(rect?.width, 1));
  const rectHeight = Math.max(1, finite(rect?.height, 1));
  return {
    ...startView,
    x: finite(startView?.x) - (finite(currentPoint?.x) - finite(startPoint?.x)) * finite(startView?.width, 1) / rectWidth,
    y: finite(startView?.y) - (finite(currentPoint?.y) - finite(startPoint?.y)) * finite(startView?.height, 1) / rectHeight,
  };
}

export function zoomViewAtClientPoint(view, rect, point, factor, limits = {}) {
  const safeFactor = Math.max(1e-6, finite(factor, 1));
  return fitViewToGesture(view, rect, point, 1, point, 1 / safeFactor, limits);
}
