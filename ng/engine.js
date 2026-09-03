import { eventBus } from "./core/EventBus.js";
import { WindowManager } from "./core/WindowManager.js";
import { WindowDefinitionStore } from "./core/WindowDefinitionStore.js";
import { DesktopShell } from "./desktop/DesktopShell.js";
import { VariableStore } from "./core/VariableStore.js";
import { ActivityDefinitionStore } from "./core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "./core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./core/ActivityExecutionService.js";

/**
 * engine.js - the ng/ composition root (plan §2.2). Phase 1 wired up the
 * desktop shell and window kernel; Phase 2 adds the generic Activity
 * runtime (VariableStore stand-in + queues + execution service). Public
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

  // DEV-TOOLS:START
  if (isDevEntry()) {
    const { initDeveloperMode, buildDeveloperDesktopIcon } = await import("./dev/DeveloperMode.js");
    await initDeveloperMode({ engineConfig, windowManager, windowDefinitionStore });
    icons.push(buildDeveloperDesktopIcon());
  }
  // DEV-TOOLS:END

  shell.mountIcons(icons);

  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);

  if (Array.isArray(engineConfig.activityLists)) {
    for (const listFile of engineConfig.activityLists) {
      const listResponse = await fetch(`data/activity-lists/${listFile}`);
      const list = await listResponse.json();
      await activityDefinitionStore.loadManifest(list.activityIds, "data/activities/");
    }
  }

  if (engineConfig.defaultActivity) {
    const { queueId, activityId } = engineConfig.defaultActivity;
    const queue = activityQueueRegistry.get(queueId);
    const definition = activityDefinitionStore.get(activityId);
    if (queue && definition) {
      const instance = queue.append({ activityId });
      activityExecutionService.run({ queue, definition, instance, variableStore });
    }
  }

  eventBus.emit("engine:ready", {});
  return {
    eventBus,
    windowManager,
    windowDefinitionStore,
    shell,
    variableStore,
    activityDefinitionStore,
    activityQueueRegistry,
    activityExecutionService,
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap(document.getElementById("ng-root"));
  });
}
