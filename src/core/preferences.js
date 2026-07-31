export const PREFERENCES_KEY = "sketchpad-next.settings.v1";
export const PREFERENCES_CHANGE_EVENT = "sketchpadnext:preferenceschange";

export const DEFAULT_PREFERENCES = Object.freeze({
  preferencesVersion: 2,
  pointSize: 6,
  pointColor: "#000000",
  autoNamePoints: false,
  lineWidth: 2,
  lineColor: "#334155",
  lineDash: "solid",
  showLabels: true,
  snapToGrid: false,
  gridSize: 20,
  shortcutsEnabled: true,
  measurementDecimals: 2,
  textFontSize: 16,
  pointLabelFontSize: 17,
});

function finiteNumber(value, fallback, minimum, maximum, step = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(maximum, Math.max(minimum, numeric));
  if (!step) return clamped;
  const stepped = Math.round(clamped / step) * step;
  return Number(stepped.toFixed(8));
}

function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

/**
 * Normalize persisted settings while preserving fields owned by newer versions.
 * This lets the settings panel share the application's existing localStorage key.
 */
export function normalizePreferences(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyPointColor = source.preferencesVersion == null
    && String(source.pointColor || "").toLowerCase() === "#2563eb";
  return {
    ...source,
    preferencesVersion: 2,
    pointSize: finiteNumber(source.pointSize, DEFAULT_PREFERENCES.pointSize, 3, 14, 1),
    pointColor: legacyPointColor
      ? DEFAULT_PREFERENCES.pointColor
      : color(source.pointColor, DEFAULT_PREFERENCES.pointColor),
    autoNamePoints: source.autoNamePoints === true,
    lineWidth: finiteNumber(source.lineWidth, DEFAULT_PREFERENCES.lineWidth, 0.5, 8, 0.5),
    lineColor: color(source.lineColor, DEFAULT_PREFERENCES.lineColor),
    lineDash: source.lineDash === "dashed" ? "dashed" : "solid",
    showLabels: source.showLabels !== false,
    snapToGrid: source.snapToGrid === true,
    gridSize: finiteNumber(source.gridSize, DEFAULT_PREFERENCES.gridSize, 5, 100, 1),
    shortcutsEnabled: source.shortcutsEnabled !== false,
    measurementDecimals: finiteNumber(source.measurementDecimals, DEFAULT_PREFERENCES.measurementDecimals, 0, 10, 1),
    textFontSize: finiteNumber(source.textFontSize, DEFAULT_PREFERENCES.textFontSize, 8, 72, 1),
    pointLabelFontSize: finiteNumber(source.pointLabelFontSize, DEFAULT_PREFERENCES.pointLabelFontSize, 8, 48, 1),
  };
}

export function loadPreferences(storage = globalThis.localStorage, key = PREFERENCES_KEY) {
  try {
    const stored = storage?.getItem(key);
    return normalizePreferences(stored ? JSON.parse(stored) : {});
  } catch {
    return normalizePreferences();
  }
}

export function savePreferences(value, storage = globalThis.localStorage, key = PREFERENCES_KEY) {
  const normalized = normalizePreferences(value);
  try {
    storage?.setItem(key, JSON.stringify(normalized));
  } catch {
    // Private browsing and quota errors must not prevent drawing.
  }
  return normalized;
}

export function mergePreferences(current, patch) {
  return normalizePreferences({ ...normalizePreferences(current), ...(patch || {}) });
}

export function resetPreferences(storage = globalThis.localStorage, key = PREFERENCES_KEY) {
  return savePreferences(DEFAULT_PREFERENCES, storage, key);
}

/** Snapping and its visual grid deliberately share one source of truth. */
export function isSnapGridVisible(preferences) {
  return normalizePreferences(preferences).snapToGrid;
}
