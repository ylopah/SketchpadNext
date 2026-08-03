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
  settingsGridSize: ["gridSize", "value"],
  settingsShortcutsEnabled: ["shortcutsEnabled", "checked"],
  settingsMeasurementDecimals: ["measurementDecimals", "value"],
  settingsTextFontSize: ["textFontSize", "value"],
  settingsPointLabelFontSize: ["pointLabelFontSize", "value"],
});

const COMMAND_MENU_IDS = Object.freeze([
  "constructionMenu",
  "measurementMenu",
  "transformMenu",
  "dataMenu",
  "displayMenu",
]);

const INTERFACE_HELP_SECTION = Object.freeze({
  id: "interface",
  title: "界面与快速操作",
  items: Object.freeze([
    { title: "给点命名", description: "新建点默认不显示名称。选择文本工具后点击未命名点，会按当前空缺的字母顺序生成名称；再次点击可继续编辑。" },
    { title: "悬停菜单", description: "使用桌面鼠标时，把光标停在画布上方的构造、度量等菜单即可展开；键盘和触屏设备仍可单击打开。" },
    { title: "属性栏预览", description: "桌面端收起属性栏后，把光标移到窗口右侧的窄边缘可临时展开；移开后自动收回，单击“属性”可固定展开。" },
  ]),
});

function enhanceCommandMenus(documentObject) {
  const root = documentObject.documentElement;
  const windowObject = documentObject.defaultView || globalThis.window;
  const menus = [];
  const isFineDesktop = () => root.dataset.device === "desktop" && root.dataset.input === "fine";

  const closeMenu = (menu, { restoreFocus = false } = {}) => {
    if (!menu?.open) return;
    menu.open = false;
    menu.wrapper.dataset.open = "false";
    menu.trigger.setAttribute("aria-expanded", "false");
    menu.popover.hidden = true;
    if (restoreFocus) menu.trigger.focus();
  };

  const closeAll = (except = null) => {
    for (const menu of menus) if (menu !== except) closeMenu(menu);
  };

  const openMenu = (menu, focus = null) => {
    if (!menu || !isFineDesktop()) return;
    closeAll(menu);
    menu.open = true;
    menu.wrapper.dataset.open = "true";
    menu.trigger.setAttribute("aria-expanded", "true");
    menu.popover.hidden = false;
    if (focus === "first") menu.items.find((item) => !item.disabled)?.focus();
    if (focus === "last") [...menu.items].reverse().find((item) => !item.disabled)?.focus();
  };

  const addOption = (menu, option, container) => {
    if (!option.value) return;
    const button = documentObject.createElement("button");
    button.type = "button";
    button.className = "command-menu-item";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.disabled = option.disabled;
    button.textContent = option.textContent;
    button.addEventListener("click", () => {
      if (button.disabled) return;
      menu.select.value = option.value;
      menu.select.dispatchEvent(new windowObject.Event("change", { bubbles: true }));
      closeMenu(menu, { restoreFocus: true });
    });
    menu.items.push(button);
    container.append(button);
  };

  for (const id of COMMAND_MENU_IDS) {
    const select = documentObject.getElementById(id);
    if (!select || select.dataset.enhanced === "true") continue;
    select.dataset.enhanced = "true";

    const wrapper = documentObject.createElement("div");
    wrapper.className = "enhanced-command-menu";
    wrapper.dataset.menuId = id;
    wrapper.dataset.open = "false";
    const trigger = documentObject.createElement("button");
    const popover = documentObject.createElement("div");
    const triggerId = `${id}EnhancedTrigger`;
    const popoverId = `${id}EnhancedMenu`;
    trigger.type = "button";
    trigger.id = triggerId;
    trigger.className = "command-menu-trigger";
    trigger.textContent = select.options[0]?.textContent?.replace(/…+$/u, "") || select.getAttribute("aria-label") || "菜单";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-controls", popoverId);
    trigger.setAttribute("aria-expanded", "false");
    popover.id = popoverId;
    popover.className = "command-menu-popover";
    popover.setAttribute("role", "menu");
    popover.setAttribute("aria-labelledby", triggerId);
    popover.hidden = true;

    const menu = { select, wrapper, trigger, popover, items: [], open: false, openTimer: null, closeTimer: null };
    for (const child of select.children) {
      if (child.tagName === "OPTGROUP") {
        const group = documentObject.createElement("section");
        group.className = "command-menu-group";
        group.setAttribute("role", "group");
        const label = documentObject.createElement("span");
        label.className = "command-menu-group-label";
        label.textContent = child.label;
        group.setAttribute("aria-label", child.label);
        group.append(label);
        for (const option of child.children) addOption(menu, option, group);
        popover.append(group);
      } else {
        addOption(menu, child, popover);
      }
    }

    trigger.addEventListener("click", () => {
      if (menu.open) closeMenu(menu);
      else openMenu(menu);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      openMenu(menu, event.key === "ArrowDown" ? "first" : "last");
    });
    popover.addEventListener("keydown", (event) => {
      const enabled = menu.items.filter((item) => !item.disabled);
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(menu, { restoreFocus: true });
        return;
      }
      if (event.key === "Tab") {
        closeMenu(menu);
        return;
      }
      const current = enabled.indexOf(documentObject.activeElement);
      let next = null;
      if (event.key === "ArrowDown") next = enabled[(current + 1 + enabled.length) % enabled.length];
      if (event.key === "ArrowUp") next = enabled[(current - 1 + enabled.length) % enabled.length];
      if (event.key === "Home") next = enabled[0];
      if (event.key === "End") next = enabled.at(-1);
      if (!next) return;
      event.preventDefault();
      next.focus();
    });
    wrapper.addEventListener("pointerenter", (event) => {
      if (!isFineDesktop() || event.pointerType === "touch") return;
      windowObject.clearTimeout(menu.closeTimer);
      menu.openTimer = windowObject.setTimeout(() => openMenu(menu), 90);
    });
    wrapper.addEventListener("pointerleave", (event) => {
      if (!isFineDesktop() || event.pointerType === "touch") return;
      windowObject.clearTimeout(menu.openTimer);
      menu.closeTimer = windowObject.setTimeout(() => {
        if (!wrapper.contains(documentObject.activeElement)) closeMenu(menu);
      }, 180);
    });
    wrapper.addEventListener("focusout", () => {
      windowObject.setTimeout(() => {
        if (!wrapper.contains(documentObject.activeElement) && !wrapper.matches(":hover")) closeMenu(menu);
      });
    });

    wrapper.append(trigger, popover);
    select.insertAdjacentElement("afterend", wrapper);
    menus.push(menu);
  }

  documentObject.addEventListener("pointerdown", (event) => {
    if (!menus.some((menu) => menu.wrapper.contains(event.target))) closeAll();
  });
  documentObject.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
  windowObject.addEventListener("sketchpadnext:layoutmodechange", () => {
    if (!isFineDesktop()) closeAll();
  });

  return { closeAll };
}

function renderHelp(container, documentObject) {
  if (!container || container.childElementCount) return;
  for (const section of [...HELP_SECTIONS, INTERFACE_HELP_SECTION]) {
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
  const root = documentObject.documentElement;
  const environment = initializeClientEnvironment(documentObject, windowObject);
  const appShell = documentObject.querySelector(".app-shell");
  const helpDialog = documentObject.getElementById("helpDialog");
  const settingsDialog = documentObject.getElementById("settingsDialog");
  const settingsForm = documentObject.getElementById("settingsForm");
  const inspector = documentObject.getElementById("inspectorPanel");
  const inspectorClose = documentObject.getElementById("inspectorCloseButton");
  const inspectorBackdrop = documentObject.getElementById("inspectorBackdrop");
  const mobileActionsMenu = documentObject.getElementById("mobileActionsMenu");
  let lastTrigger = null;
  let inspectorTrigger = null;
  const inspectorLayoutMode = (current) =>
    current?.device === "phone" ? `phone:${current.orientation}` : current?.device || "desktop";
  let currentInspectorLayoutMode = inspectorLayoutMode(environment.current);

  renderHelp(documentObject.getElementById("helpDialogContent"), documentObject);
  const commandMenus = enhanceCommandMenus(documentObject);

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

  const setInspectorOpen = (open, trigger = null, { restoreFocus = true } = {}) => {
    if (!inspector) return;
    const compactLayout = root.dataset.device !== "desktop";
    const shouldOpen = Boolean(open);
    root.dataset.inspector = shouldOpen ? "open" : "closed";
    inspector.dataset.mobileOpen = String(compactLayout && shouldOpen);
    inspector.setAttribute("aria-hidden", String(!shouldOpen));
    if (inspectorClose) {
      const portraitPhone = root.dataset.device === "phone" && root.dataset.orientation === "portrait";
      inspectorClose.textContent = portraitPhone ? (shouldOpen ? "⌄" : "⌃") : (shouldOpen ? "›" : "‹");
      inspectorClose.setAttribute("aria-expanded", String(shouldOpen));
      inspectorClose.setAttribute("aria-label", shouldOpen ? "收起属性面板" : "展开属性面板");
      inspectorClose.title = shouldOpen ? "收起属性面板" : "展开属性面板";
    }
    if (inspectorBackdrop) inspectorBackdrop.hidden = !(compactLayout && shouldOpen);
    if (compactLayout && shouldOpen) {
      inspectorTrigger = trigger || documentObject.activeElement;
      inspectorClose?.focus?.();
    } else if (compactLayout && inspectorTrigger && restoreFocus) {
      inspectorTrigger.focus?.();
      inspectorTrigger = null;
    } else {
      inspectorTrigger = null;
    }
  };

  setInspectorOpen(environment.current.device === "desktop", null, { restoreFocus: false });

  documentObject.getElementById("helpButton")?.addEventListener("click", (event) => openDialog(helpDialog, event.currentTarget));
  documentObject.getElementById("settingsButton")?.addEventListener("click", (event) => openDialog(settingsDialog, event.currentTarget));
  inspectorClose?.addEventListener("click", (event) => {
    const compactLayout = documentObject.documentElement.dataset.device !== "desktop";
    const isOpen = compactLayout
      ? inspector?.dataset.mobileOpen === "true"
      : documentObject.documentElement.dataset.inspector !== "closed";
    setInspectorOpen(!isOpen, event.currentTarget);
  });
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

  windowObject.addEventListener("sketchpadnext:layoutmodechange", (event) => {
    const nextLayoutMode = inspectorLayoutMode(event.detail);
    if (nextLayoutMode === currentInspectorLayoutMode) return;
    currentInspectorLayoutMode = nextLayoutMode;
    setInspectorOpen(event.detail?.device === "desktop", null, { restoreFocus: false });
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
      commandMenus?.closeAll();
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
