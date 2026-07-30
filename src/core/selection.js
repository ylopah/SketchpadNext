export function selectionDragIntent(selectedIds, hitId) {
  const before = [...new Set(selectedIds)].filter(Boolean);
  const wasSelected = before.includes(hitId);
  const pointerDownSelection = wasSelected ? before : [...before, hitId];
  const exclusiveOnDrag = !wasSelected && before.length > 0;
  return {
    before,
    wasSelected,
    pointerDownSelection,
    dragSelection: exclusiveOnDrag ? [hitId] : pointerDownSelection,
    exclusiveOnDrag,
  };
}

export function hasExceededDragThreshold(startClient, currentClient, threshold = 4) {
  if (!startClient || !currentClient) return false;
  return Math.hypot(
    currentClient.x - startClient.x,
    currentClient.y - startClient.y,
  ) > threshold;
}

export function pointLinePairs(selection, isLineObject) {
  const points = [];
  const lines = [];
  for (const object of selection) {
    if (object?.type === "point") points.push(object);
    else if (isLineObject(object)) lines.push(object);
    else return [];
  }
  if (!points.length || !lines.length) return [];
  return points.flatMap((point) => lines.map((line) => ({ point, line })));
}
