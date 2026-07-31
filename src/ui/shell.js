import { HELP_SECTIONS } from "../core/help.js";
import { initializeClientEnvironment } from "../core/environment.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_CHANGE_EVENT,
  loadPreferences,
  mergePreferences,
  resetPreferences,
  savePreferences,
} from "../core/preferences.js";

const SETTINGS_FIELDS = Object.freeze({
  settingsPointSize: ["pointSize", "value"],
  settingsPointColor: ["pointColor", "value"],
  settingsLineWidth: ["lineWidth", "value"],
  settingsLineColor: ["lineColor", "value"],
  settingsLineDash: ["lineDash", "value"],
  settingsShowLabels: ["showLabels", "checked"],
  settingsSnapToGrid: ["snapToGrid", "checked"],
  settingsGridSize: ["gridSize", "value"],
  settingsShortcutsEnabled: ["shortcutsEnabled", "checked"],
  settingsMeasurementDecimals: ["measurementDecimals", "value"],
  settingsTextFontSize: ["textFontSize", "value"],
  settingsPointLabelFontSize: ["pointLabelFontSize", "value"],
});

function renderHelp(container, documentObject) {
  if (!container || container.childElementCount) return;
  for (const section of HELP_SECTIONS) {
    const article = documentObject.createElement("section");
    article.className = "help-section";
    article.id = `help-${section.id}`;
    const heading = documentObject.createElement("h3");
    heading.textContent = section.title;
    const list = documentObject.createElement("dl");
    for (const item of section.items) {
      const row = documentObject.createElement("div");
      const term = documentObject.createElement("dt");
      term.textContent = item.title;
      if (item.shortcut) {
        const shortcut = documentObject.createElement("kbd");
        shortcut.textContent = item.shortcut;
        term.append(" ", shortcut);
      }
      const description = documentObject.createElement("dd");
      description.textContent = item.description;
      row.append(term, description);
      list.append(row);
    }
    article.append(heading, list);
    container.append(article);
  }
}

function setFormValues(documentObject, preferences) {
  for (const [id, [key, property]] of Object.entries(SETTINGS_FIELDS)) {
    const control = documentObject.getElementById(id);
    if (control) control[property] = preferences[key];
  }
}

function readFormValues(documentObject) {
  const values = {};
  for (const [id, [key, property]] of Object.entries(SETTINGS_FIELDS)) {
    const control = documentObject.getElementById(id);
    if (control) values[key] = control[property];
  }
  return values;
}

function publishPreferences(windowObject, preferences) {
  windowObject.dispatchEvent(new windowObject.CustomEvent(PREFERENCES_CHANGE_EVENT, {
    detail: preferences,
  }));
}

export function initializeShellPanels(documentObject = globalThis.document, storage = globalThis.localStorage) {
  if (!documentObject || documentObject.documentElement.dataset.shellPanelsReady === "true") return null;
  documentObject.documentElement.dataset.shellPanelsReady = "true";

  const windowObject = documentObject.defaultView || globalThis.window;
  const environment = initializeClientEnvironment(documentObject, windowObject);
  const appShell = documentObject.querySelector(".app-shell");
  const helpDialog = documentObject.getElementById("helpDialog");
  const settingsDialog = documentObject.getElementById("settingsDialog");
  const settingsForm = documentObject.getElementById("settingsForm");
  const inspector = documentObject.getElementById("inspectorPanel");
  const inspectorToggle = documentObject.getElementById("inspectorToggleButton");
  const inspectorClose = documentObject.getElementById("inspectorCloseButton");
  const inspectorBackdrop = documentObject.getElementById("inspectorBackdrop");
  const mobileActionsMenu = documentObject.getElementById("mobileActionsMenu");
  let lastTrigger = null;
  let inspectorTrigger = null;

  renderHelp(documentObject.getElementById("helpDialogContent"), documentObject);

  const closeDialog = (dialog) => {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    if (helpDialog?.hidden && settingsDialog?.hidden) appShell?.removeAttribute("inert");
    lastTrigger?.focus?.();
    lastTrigger = null;
  };

  const openDialog = (dialog, trigger) => {
    if (!dialog) return;
    if (dialog === helpDialog) closeDialog(settingsDialog);
    if (dialog === settingsDialog) {
      closeDialog(helpDialog);
      setFormValues(documentObject, loadPreferences(storage));
    }
    lastTrigger = trigger || documentObject.activeElement;
    appShell?.setAttribute("inert", "");
    dialog.hidden = false;
    dialog.querySelector("button, input, select")?.focus();
  };

  const setInspectorOpen = (open, trigger = null) => {
    if (!inspector) return;
    const compactLayout = documentObject.documentElement.dataset.device !== "desktop";
    const shouldOpen = compactLayout && Boolean(open);
    inspector.dataset.mobileOpen = String(shouldOpen);
    inspector.setAttribute("aria-hidden", String(compactLayout && !shouldOpen));
    inspectorToggle?.setAttribute("aria-expanded", String(shouldOpen));
    if (inspectorBackdrop) inspectorBackdrop.hidden = !shouldOpen;
    if (shouldOpen) {
      inspectorTrigger = trigger || documentObject.activeElement;
      inspectorClose?.focus?.();
    } else if (inspectorTrigger) {
      inspectorTrigger.focus?.();
      inspectorTrigger = null;
    }
  };

  setInspectorOpen(false);

  documentObject.getElementById("helpButton")?.addEventListener("click", (event) => openDialog(helpDialog, event.currentTarget));
  documentObject.getElementById("settingsButton")?.addEventListener("click", (event) => openDialog(settingsDialog, event.currentTarget));
  inspectorToggle?.addEventListener("click", (event) => {
    setInspectorOpen(inspector?.dataset.mobileOpen !== "true", event.currentTarget);
  });
  inspectorClose?.addEventListener("click", () => setInspectorOpen(false));
  inspectorBackdrop?.addEventListener("click", () => setInspectorOpen(false));
  documentObject.querySelectorAll("[data-proxy-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = documentObject.getElementById(button.dataset.proxyButton);
      mobileActionsMenu?.removeAttribute("open");
      target?.click();
    });
  });
  documentObject.addEventListener("pointerdown", (event) => {
    if (mobileActionsMenu?.open && !mobileActionsMenu.contains(event.target)) {
      mobileActionsMenu.removeAttribute("open");
    }
  });
  documentObject.querySelectorAll("[data-close-shell-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest(".shell-dialog")));
  });
  for (const dialog of [helpDialog, settingsDialog]) {
    dialog?.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  }
  documentObject.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = [settingsDialog, helpDialog].find((dialog) => dialog && !dialog.hidden);
    if (open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDialog(open);
    } else if (inspector?.dataset.mobileOpen === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setInspectorOpen(false);
    }
  }, true);

  windowObject.addEventListener("sketchpadnext:layoutmodechange", () => {
    setInspectorOpen(false);
  });

  settingsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const preferences = savePreferences(
      mergePreferences(loadPreferences(storage), readFormValues(documentObject)),
      storage,
    );
    publishPreferences(windowObject, preferences);
    closeDialog(settingsDialog);
  });

  documentObject.getElementById("resetSettingsButton")?.addEventListener("click", () => {
    setFormValues(documentObject, DEFAULT_PREFERENCES);
    const status = documentObject.getElementById("settingsStatus");
    if (status) status.textContent = "已恢复推荐值；点击“保存设置”后生效。";
  });

  const snapToggle = documentObject.getElementById("snapToggle");
  snapToggle?.addEventListener("change", () => {
    const preferences = savePreferences(
      mergePreferences(loadPreferences(storage), { snapToGrid: snapToggle.checked }),
      storage,
    );
    publishPreferences(windowObject, preferences);
  });

  return {
    environment,
    openHelp: (trigger) => openDialog(helpDialog, trigger),
    openSettings: (trigger) => openDialog(settingsDialog, trigger),
    openInspector: (trigger) => setInspectorOpen(true, trigger),
    close: () => {
      [helpDialog, settingsDialog].forEach(closeDialog);
      setInspectorOpen(false);
    },
    reset: () => {
      const preferences = resetPreferences(storage);
      setFormValues(documentObject, preferences);
      publishPreferences(windowObject, preferences);
      return preferences;
    },
  };
}

if (typeof document !== "undefined") initializeShellPanels();
