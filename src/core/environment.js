const PHONE_UA_PATTERN = /Android.*Mobile|iPhone|iPod|IEMobile|Opera Mini|Mobile Safari/i;
const TABLET_UA_PATTERN = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i;

function cleanDimension(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function browserName(userAgent) {
  if (/SamsungBrowser/i.test(userAgent)) return "Samsung Internet";
  if (/EdgiOS|EdgA|Edg\//i.test(userAgent)) return "Edge";
  if (/OPiOS|OPR\//i.test(userAgent)) return "Opera";
  if (/FxiOS|Firefox\//i.test(userAgent)) return "Firefox";
  if (/CriOS|Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "浏览器";
}

function operatingSystem(userAgent, platform, isIPadOS) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || isIPadOS) return "iOS/iPadOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows/i.test(userAgent) || /Win/i.test(platform)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent) || /Mac/i.test(platform)) return "macOS";
  if (/Linux/i.test(userAgent) || /Linux/i.test(platform)) return "Linux";
  return "未知系统";
}

export function detectClientEnvironment(input = {}) {
  const userAgent = String(input.userAgent || "");
  const platform = String(input.platform || "");
  const maxTouchPoints = Math.max(0, Number(input.maxTouchPoints) || 0);
  const viewportWidth = cleanDimension(input.viewportWidth, 1200);
  const viewportHeight = cleanDimension(input.viewportHeight, 720);
  const shortSide = Math.min(viewportWidth, viewportHeight);
  const longSide = Math.max(viewportWidth, viewportHeight);
  const isIPadOS = platform === "MacIntel" && maxTouchPoints > 1;
  const coarsePointer = input.coarsePointer === true;
  const mobileHint = input.userAgentDataMobile === true || PHONE_UA_PATTERN.test(userAgent);
  const tabletHint = isIPadOS || TABLET_UA_PATTERN.test(userAgent);
  const compactPhoneViewport = shortSide <= 600 && longSide <= 980;
  const tabletViewport = viewportWidth <= 1180;

  const device = tabletHint
    ? "tablet"
    : mobileHint || compactPhoneViewport
      ? "phone"
      : tabletViewport
        ? "tablet"
        : "desktop";
  const orientation = ["portrait", "landscape"].includes(input.orientation)
    ? input.orientation
    : viewportWidth >= viewportHeight ? "landscape" : "portrait";
  const inputMode = coarsePointer || mobileHint || tabletHint ? "coarse" : "fine";
  const browser = browserName(userAgent);
  const os = operatingSystem(userAgent, platform, isIPadOS);
  const deviceLabel = device === "phone" ? "手机" : device === "tablet" ? "平板" : "桌面";

  return {
    device,
    orientation,
    input: inputMode,
    browser,
    os,
    viewportWidth,
    viewportHeight,
    label: `${deviceLabel} · ${browser}`,
    userAgent,
  };
}

export function initializeClientEnvironment(
  documentObject = globalThis.document,
  windowObject = globalThis.window,
) {
  if (!documentObject?.documentElement || !windowObject) return null;
  const root = documentObject.documentElement;
  const navigatorObject = windowObject.navigator || {};
  const badge = documentObject.getElementById("environmentBadge");
  let signature = "";
  let current = null;
  let scheduledFrame = null;

  const update = () => {
    const viewport = windowObject.visualViewport;
    const layoutWidth = cleanDimension(windowObject.innerWidth, root.clientWidth || 1200);
    const layoutHeight = cleanDimension(windowObject.innerHeight, root.clientHeight || 720);
    const viewportHeight = cleanDimension(viewport?.height, layoutHeight);
    const portraitQuery = windowObject.matchMedia?.("(orientation: portrait)");
    const landscapeQuery = windowObject.matchMedia?.("(orientation: landscape)");
    const orientationType = String(windowObject.screen?.orientation?.type || "");
    const orientation = portraitQuery?.matches
      ? "portrait"
      : landscapeQuery?.matches
        ? "landscape"
        : orientationType.startsWith("portrait")
          ? "portrait"
          : "landscape";
    current = detectClientEnvironment({
      userAgent: navigatorObject.userAgent,
      userAgentDataMobile: navigatorObject.userAgentData?.mobile,
      platform: navigatorObject.platform,
      maxTouchPoints: navigatorObject.maxTouchPoints,
      coarsePointer: windowObject.matchMedia?.("(pointer: coarse)")?.matches,
      viewportWidth: layoutWidth,
      viewportHeight: layoutHeight,
      orientation,
    });
    root.dataset.device = current.device;
    root.dataset.orientation = current.orientation;
    root.dataset.input = current.input;
    root.dataset.browser = current.browser.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "") || "other";
    root.dataset.os = current.os.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
    root.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
    if (badge) {
      badge.textContent = current.label;
      const detail = `${current.browser} · ${current.os} · ${current.orientation === "portrait" ? "竖屏" : "横屏"}\nUA: ${current.userAgent || "不可用"}`;
      badge.title = detail;
      badge.dataset.detail = detail;
      badge.setAttribute("aria-label", current.label + "，点击查看完整浏览器信息");
    }
    const nextSignature = [current.device, current.orientation, current.input, Math.round(layoutWidth), Math.round(layoutHeight), Math.round(viewportHeight)].join("|");
    if (nextSignature !== signature) {
      signature = nextSignature;
      windowObject.dispatchEvent(new windowObject.CustomEvent("sketchpadnext:layoutmodechange", {
        detail: { ...current },
      }));
    }
    return current;
  };

  const setBadgeOpen = (open) => {
    if (!badge) return;
    badge.dataset.open = String(Boolean(open));
    badge.setAttribute("aria-expanded", String(Boolean(open)));
  };
  const handleBadgeClick = (event) => {
    event.stopPropagation();
    setBadgeOpen(badge?.dataset.open !== "true");
  };
  const handleDocumentPointerDown = (event) => {
    if (badge?.dataset.open === "true" && !badge.contains(event.target)) setBadgeOpen(false);
  };

  const scheduleUpdate = () => {
    if (scheduledFrame !== null) return;
    if (typeof windowObject.requestAnimationFrame !== "function") {
      update();
      return;
    }
    scheduledFrame = windowObject.requestAnimationFrame(() => {
      scheduledFrame = null;
      update();
    });
  };
  update();
  badge?.addEventListener("click", handleBadgeClick);
  documentObject.addEventListener?.("pointerdown", handleDocumentPointerDown);
  windowObject.addEventListener("resize", scheduleUpdate);
  windowObject.addEventListener("orientationchange", scheduleUpdate);
  windowObject.visualViewport?.addEventListener("resize", scheduleUpdate);

  return {
    get current() { return current; },
    update,
    destroy() {
      badge?.removeEventListener("click", handleBadgeClick);
      documentObject.removeEventListener?.("pointerdown", handleDocumentPointerDown);
      windowObject.removeEventListener("resize", scheduleUpdate);
      windowObject.removeEventListener("orientationchange", scheduleUpdate);
      windowObject.visualViewport?.removeEventListener("resize", scheduleUpdate);
      if (scheduledFrame !== null) windowObject.cancelAnimationFrame?.(scheduledFrame);
      scheduledFrame = null;
    },
  };
}
