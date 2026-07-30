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

export function angleBisectorFromCommonEndpoint(selection) {
  if (!Array.isArray(selection) || selection.length !== 2) return null;
  const [first, second] = selection;
  const supportedTypes = new Set(["segment", "line", "ray"]);
  if (!supportedTypes.has(first?.type) || !supportedTypes.has(second?.type) || first.id === second.id) return null;
  const firstEndpoints = [first.pointAId, first.pointBId].filter(Boolean);
  const secondEndpoints = [second.pointAId, second.pointBId].filter(Boolean);
  const common = firstEndpoints.filter((id) => secondEndpoints.includes(id));
  if (common.length !== 1) return null;
  const vertexId = common[0];
  const pointAId = firstEndpoints.find((id) => id !== vertexId);
  const pointBId = secondEndpoints.find((id) => id !== vertexId);
  if (!pointAId || !pointBId || pointAId === pointBId) return null;
  return {
    vertexId,
    pointAId,
    pointBId,
    sideAId: first.id,
    sideBId: second.id,
  };
}
