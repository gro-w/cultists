import { eventBus } from "./core/EventBus.js";
import { WindowManager } from "./core/WindowManager.js";
import { WindowDefinitionStore } from "./core/WindowDefinitionStore.js";
import { DesktopShell } from "./desktop/DesktopShell.js";
import { VariableStore } from "./core/VariableStore.js";
import { ActivityDefinitionStore } from "./core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "./core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./core/ActivityExecutionService.js";
import { GameClock } from "./core/GameClock.js";
import { validateBlueprint } from "./core/ActivityValidator.js";
import { DesktopIconManager } from "./core/DesktopIconManager.js";
import { buildBuiltinIconBlueprint } from "./core/BuiltinIconBlueprints.js";
import { DataStructureManager } from "./core/DataStructureManager.js";
import { DataStore } from "./core/DataStore.js";
import { PublicVariableManager } from "./core/PublicVariableManager.js";
import { RuntimeRefResolver } from "./core/RuntimeRefResolver.js";

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

  const gameClock = new GameClock(eventBus);
  const variableStore = new VariableStore(eventBus);
  const dataStructureManager = new DataStructureManager();
  const dataStore = new DataStore(dataStructureManager);
  const refResolver = new RuntimeRefResolver();
  const publicVariableManager = new PublicVariableManager(refResolver, eventBus);

  if (engineConfig.structures) {
    const structuresResponse = await fetch(`data/${engineConfig.structures}`);
    if (structuresResponse.ok) dataStructureManager.loadDefinitions(await structuresResponse.json());
  }
  if (engineConfig.databases) {
    const databasesResponse = await fetch(`data/${engineConfig.databases}`);
    if (databasesResponse.ok) dataStore.loadDefinitions(await databasesResponse.json());
  }
  if (engineConfig.publicVariables) {
    const publicVariablesResponse = await fetch(`data/${engineConfig.publicVariables}`);
    if (publicVariablesResponse.ok) publicVariableManager.loadDefinitions(await publicVariablesResponse.json());
  }

  // Every structure-backed database record is resolvable as an "object"-typed
  // public variable's ref via `{objectType:"database:<databaseId>", objectId:<primaryKey>}`
  // - a generic mechanism (no per-database code), registered once every
  // database is loaded.
  dataStore.listDatabases().forEach(({ databaseId }) => {
    refResolver.register(`database:${databaseId}`, (recordKey) => dataStore.getRecord(databaseId, recordKey));
  });

  const shell = new DesktopShell(windowManager, windowDefinitionStore, eventBus, rootEl, gameClock, variableStore);

  const activityDefinitionStore = new ActivityDefinitionStore();
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);

  /** Runs an Activity by id on the given queue (default "main"), wired with the shared gameClock/windowManager gateways. */
  function runActivity(activityId, queueId = "main") {
    const queue = activityQueueRegistry.get(queueId);
    const definition = activityDefinitionStore.get(activityId);
    if (!queue || !definition) return null;
    const instance = queue.append({ activityId });
    return activityExecutionService.run({
      queue,
      definition,
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      windowGateway: (windowId) => shell.openWindow(windowId),
      activityGateway: (id, activityQueueId) => runActivity(id, activityQueueId || "main"),
      eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
      dbGateway: dataStore,
      pvGateway: publicVariableManager,
    });
  }
  shell.runActivity = runActivity;

  // Every window's optional `events.onCreate`/`onDestroy` inline blueprint
  // (plan §4.2) executes through this exact same ActivityExecutionService -
  // never a second bespoke Runner - on a dedicated non-blocking queue kept
  // separate from gameplay Activities so the debugger/save data for the two
  // never mix. This is a general window-lifecycle mechanism, not specific
  // to any one window: any custom window definition can declare these.
  const windowEventsQueue = activityQueueRegistry.register("window-events", { nonBlocking: true });

  /** Runs an inline (non-stored) Blueprint through ActivityExecutionService, exactly like a normal Activity. */
  function runInlineBlueprint(queue, activityId, blueprint, errorContext) {
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) {
      console.error(`Invalid blueprint for ${errorContext}: ${validation.errors.join("；")}`);
      return null;
    }
    const instance = queue.append({ activityId });
    return activityExecutionService.run({
      queue,
      definition: { id: activityId, blueprint: validation.blueprint },
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      windowGateway: (id) => shell.openWindow(id),
      activityGateway: (id, activityQueueId) => runActivity(id, activityQueueId || "main"),
      eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
      dbGateway: dataStore,
      pvGateway: publicVariableManager,
    });
  }

  function runWindowLifecycleEvent(windowId, eventName) {
    const definition = windowDefinitionStore.get(windowId);
    const blueprint = definition?.events?.[eventName];
    if (!blueprint) return null;
    return runInlineBlueprint(windowEventsQueue, `window:${windowId}:${eventName}`, blueprint, `window "${windowId}" ${eventName}`);
  }
  eventBus.on("window:opened", ({ windowId }) => runWindowLifecycleEvent(windowId, "onCreate"));
  eventBus.on("window:closed", ({ windowId }) => runWindowLifecycleEvent(windowId, "onDestroy"));

  /** Depth-first search for a widget node by id inside a window's `root` widget tree. */
  function findWidgetNode(root, widgetId) {
    if (!root) return null;
    if (root.widgetId === widgetId) return root;
    if (root.type !== "container") return null;
    for (const child of root.children || []) {
      const found = findWidgetNode(child, widgetId);
      if (found) return found;
    }
    return null;
  }

  // Every widget can likewise declare `events.onClick`/`onChange`/`onFocus`/
  // `onBlur` inline blueprints (plan §4.2/§7.3 "所有组件事件都创建
  // Activity，通过统一执行服务运行"), kept on their own queue so a flood of
  // UI interactions never crowds the window-lifecycle queue's history.
  const widgetEventsQueue = activityQueueRegistry.register("widget-events", { nonBlocking: true });
  function runWidgetEvent(windowId, widgetId, eventName, value) {
    const definition = windowDefinitionStore.get(windowId);
    const widget = findWidgetNode(definition?.root, widgetId);
    const blueprint = widget?.events?.[eventName];
    if (!blueprint) return null;
    // The triggering value (e.g. a textInput's new text, a checkbox's new
    // checked state) is exposed to the blueprint via the same `{variable}`
    // read shorthand every other value input already understands, under a
    // well-known key - no new node type needed.
    if (value !== undefined) variableStore.set("event:value", value);
    return runInlineBlueprint(widgetEventsQueue, `widget:${windowId}:${widgetId}:${eventName}`, blueprint, `widget "${widgetId}" ${eventName}`);
  }
  shell.runWidgetEvent = runWidgetEvent;

  // Desktop icon double-clicks (plan §8.2) resolve to a Blueprint by
  // `blueprintId` - either one of the built-ins (BuiltinIconBlueprints.js)
  // or a custom Activity already loaded into activityDefinitionStore -
  // and run it through the exact same ActivityExecutionService, on its own
  // non-blocking queue so icon activations never mix with gameplay/window
  // Activity history.
  const desktopIconsQueue = activityQueueRegistry.register("desktop-icons", { nonBlocking: true });
  function runIconBlueprint(icon) {
    const builtin = buildBuiltinIconBlueprint(icon.blueprintId, icon.inputs || {});
    if (builtin) {
      return runInlineBlueprint(desktopIconsQueue, `icon:${icon.iconId}`, builtin, `icon "${icon.iconId}"`);
    }
    const definition = activityDefinitionStore.get(icon.blueprintId);
    if (!definition) {
      console.error(`Icon "${icon.iconId}" declares unknown blueprintId "${icon.blueprintId}"`);
      return null;
    }
    const instance = desktopIconsQueue.append({ activityId: icon.blueprintId });
    return activityExecutionService.run({
      queue: desktopIconsQueue,
      definition,
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      windowGateway: (id) => shell.openWindow(id),
      activityGateway: (id, activityQueueId) => runActivity(id, activityQueueId || "main"),
      eventGateway: (eventName, payload) => eventBus.emit(eventName, payload),
      dbGateway: dataStore,
      pvGateway: publicVariableManager,
    });
  }
  shell.runIconBlueprint = runIconBlueprint;

  if (Array.isArray(engineConfig.activityLists)) {
    for (const listFile of engineConfig.activityLists) {
      const listResponse = await fetch(`data/activity-lists/${listFile}`);
      const list = await listResponse.json();
      await activityDefinitionStore.loadManifest(list.activityIds, "data/activities/");
    }
  }

  const iconManager = new DesktopIconManager(icons);

  // DEV-TOOLS:START
  if (isDevEntry()) {
    const { initDeveloperMode, buildDeveloperDesktopIcons } = await import("./dev/DeveloperMode.js");
    await initDeveloperMode({
      engineConfig,
      windowManager,
      windowDefinitionStore,
      activityQueueRegistry,
      eventBus,
      variableStore,
      iconManager,
      dataStructureManager,
      dataStore,
      publicVariableManager,
      refreshIcons: () => shell.mountIcons(iconManager),
    });
    buildDeveloperDesktopIcons().forEach((icon) => iconManager.register(icon));
  }
  // DEV-TOOLS:END

  shell.mountIcons(iconManager);

  if (engineConfig.defaultActivity) {
    const { activityId, queueId } = engineConfig.defaultActivity;
    runActivity(activityId, queueId);
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
    gameClock,
    dataStructureManager,
    dataStore,
    publicVariableManager,
    refResolver,
    iconManager,
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap(document.getElementById("ng-root"));
  });
}
