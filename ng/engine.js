import { eventBus } from "./core/EventBus.js";
import { WindowManager } from "./core/WindowManager.js";
import { WindowDefinitionStore } from "./core/WindowDefinitionStore.js";
import { DesktopShell } from "./desktop/DesktopShell.js";

/**
 * engine.js - the ng/ composition root (plan §2.2). Phase 1 only wires up
 * the desktop shell and window kernel; the Activity runtime, public
 * variables, data structures and dev tools arrive in later phases and are
 * deliberately not referenced here yet.
 */

/** Strict dev entry: the whole query string must be exactly "?dev". */
export function isDevEntry(search = typeof location !== "undefined" ? location.search : "") {
  return search === "?dev";
}

export async function bootstrap(rootEl) {
  const windowManager = new WindowManager(eventBus);
  const windowDefinitionStore = new WindowDefinitionStore();

  const engineConfigResponse = await fetch("data/engine.json");
  const engineConfig = await engineConfigResponse.json();

  await windowDefinitionStore.loadManifest(engineConfig.windowManifest, "data/windows/");

  const iconsResponse = await fetch(`data/${engineConfig.desktopIcons}`);
  const icons = await iconsResponse.json();

  const shell = new DesktopShell(windowManager, windowDefinitionStore, eventBus, rootEl);
  shell.mountIcons(icons);

  eventBus.emit("engine:ready", {});
  return { eventBus, windowManager, windowDefinitionStore, shell };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap(document.getElementById("ng-root"));
  });
}
