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
import { SaveManager } from "./core/SaveManager.js";
import { SaveLoadView } from "./desktop/SaveLoadView.js";
import { DialogueView } from "./desktop/DialogueView.js";
import { KeywordManager } from "./core/KeywordManager.js";
import { NotebookView } from "./desktop/NotebookView.js";
import { OnboardingManager } from "./core/OnboardingManager.js";
import { TutorialOverlay } from "./desktop/TutorialOverlay.js";

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

  // Generic milestone/hint mechanic (mirrors legacy js/core/OnboardingManager.js's
  // effect, but is fully data-driven: `data/onboarding.json`'s hints are the
  // only content this module ever reads, exactly like keywordManager only
  // reads the `keywords` database). Created early so its `markMilestone`
  // gateway can be threaded through every ActivityExecutionService.run()
  // call site below, same convention as dbGateway/pvGateway.
  const onboardingManager = new OnboardingManager({ eventBus });
  if (engineConfig.onboarding) {
    const onboardingResponse = await fetch(`data/${engineConfig.onboarding}`);
    if (onboardingResponse.ok) onboardingManager.loadHints(await onboardingResponse.json());
  }

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
  // Generic seed-content loader (plan §9.3): a `{ databaseId: records[] }`
  // map of pre-authored records, config-driven exactly like
  // structures/databases/publicVariables above - not a per-domain importer.
  // `seedRecords` may be a single filename or an array of filenames (large
  // domains like the 48,195-entry ChatGTP QA table are split into their own
  // file so the "main" seed file stays reviewable) - every file's map is
  // merged into the same DataStore via loadRecordSet.
  if (engineConfig.seedRecords) {
    const seedFiles = Array.isArray(engineConfig.seedRecords) ? engineConfig.seedRecords : [engineConfig.seedRecords];
    for (const seedFile of seedFiles) {
      const seedResponse = await fetch(`data/${seedFile}`);
      if (seedResponse.ok) dataStore.loadRecordSet(await seedResponse.json());
    }
  }

  // Declarative gameClock mirror (see PublicVariableManager's `syncSource`
  // doc comment): any variable data marks with `"syncSource":
  // "gameClock.totalMinutes"` is kept in lockstep with the GameClock, so
  // content can express `blockUntil`/`publicVariableCondition` waits keyed
  // off in-game time using only generic public-variable primitives.
  publicVariableManager.list()
    .filter((definition) => definition.syncSource === "gameClock.totalMinutes")
    .forEach((definition) => {
      const sync = ({ day, minutes }) => publicVariableManager.set(definition.id, (day - 1) * 1440 + minutes);
      sync(gameClock.snapshot());
      eventBus.on("gameClock:changed", sync);
    });

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
      onboardingGateway: onboardingManager,
    });
  }
  shell.runActivity = runActivity;

  /**
   * Resumes every queue's still-unresolved instance by re-running it
   * through the exact same gateways as a fresh `runActivity()` call - the
   * "恢复成功后只扫描一次待启动项" step of `SaveManager.restore()` (plan
   * §12.3). A definition missing after a data update is left as-is rather
   * than throwing, so one stale instance can't block restoring everything
   * else; queues driven by inline (non-stored) blueprints - window/widget
   * events, desktop icons - are expected to run to completion synchronously
   * and are not resumed here.
   */
  function resumePendingActivities() {
    activityQueueRegistry.list().forEach((queue) => {
      const instance = queue.current();
      if (!instance) return;
      const definition = activityDefinitionStore.get(instance.activityId);
      if (!definition) return;
      activityExecutionService.run({
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
        onboardingGateway: onboardingManager,
      });
    });
  }

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
      onboardingGateway: onboardingManager,
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
      onboardingGateway: onboardingManager,
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

  // `keywordManager` is the generic "关键词收集" mechanic (plan §8):
  // sourced from the seeded `keywords` database, its SAN-aware distorted
  // text reads public-variable id 1 (主角SAN, AGENTS.md's reserved id
  // range) - the one place this generic module is told which id that is.
  // Created before `saveManager` so its collected-set can be part of the
  // save envelope like every other domain.
  const PROTAGONIST_SAN_VARIABLE_ID = 1;
  const keywordManager = new KeywordManager({
    dataStore,
    eventBus,
    sanityProvider: () => publicVariableManager.get(PROTAGONIST_SAN_VARIABLE_ID),
  });

  const saveManager = new SaveManager({
    gameClock,
    variableStore,
    publicVariableManager,
    dataStore,
    activityQueueRegistry,
    windowManager,
    desktopIconManager: iconManager,
    keywordManager,
    onboardingManager,
    activityExecutionService,
    resumePendingActivities,
    engineVersion: engineConfig.version,
  });
  const saveLoadView = new SaveLoadView({ saveManager });
  const SAVE_LOAD_WINDOW_ID = "save-load";
  windowDefinitionStore.register({
    id: SAVE_LOAD_WINDOW_ID,
    title: "存档",
    icon: "💾",
    width: 360,
    height: 220,
    resizable: true,
    singleInstance: true,
    body: saveLoadView.el,
  });
  iconManager.register({
    iconId: "save-load",
    label: "存档",
    glyph: "💾",
    order: iconManager.list().length,
    blueprintId: "desktop.open-window",
    inputs: { windowId: SAVE_LOAD_WINDOW_ID },
  });

  // Generic dialogue-rendering window (see DialogueView.js doc comment):
  // any Activity's `text`/`choice` nodes become visible transcript/choice
  // buttons here, with no his-app/social-app specific code in the engine
  // itself. Content wires a desktop icon's `blueprintId` to an Activity
  // that opens this window then runs the actual dialogue Activity (e.g.
  // `work01a-patient1`).
  const dialogueView = new DialogueView({ eventBus, variableStore, keywordManager, gameClock });
  const DIALOGUE_WINDOW_ID = "dialogue";
  windowDefinitionStore.register({
    id: DIALOGUE_WINDOW_ID,
    title: "对话",
    icon: "💬",
    width: 480,
    height: 360,
    resizable: true,
    singleInstance: true,
    body: dialogueView.el,
  });
  eventBus.on("window:opened", ({ windowId }) => {
    if (windowId === DIALOGUE_WINDOW_ID) dialogueView.reset();
  });

  const notebookView = new NotebookView({ eventBus, keywordManager });
  const NOTEBOOK_WINDOW_ID = "notebook";
  windowDefinitionStore.register({
    id: NOTEBOOK_WINDOW_ID,
    title: "笔记本",
    icon: "📓",
    width: 360,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: notebookView.el,
  });
  iconManager.register({
    iconId: "notebook",
    label: "笔记本",
    glyph: "📓",
    order: iconManager.list().length,
    blueprintId: "desktop.open-window",
    inputs: { windowId: NOTEBOOK_WINDOW_ID },
  });
  eventBus.on("window:opened", ({ windowId }) => {
    if (windowId === NOTEBOOK_WINDOW_ID) onboardingManager.markMilestone("notebook_opened");
  });

  // TutorialOverlay is the generic visual layer for onboardingManager's
  // hints (ported near-verbatim from legacy js/desktop/TutorialOverlay.js);
  // it only listens to "onboarding:hint_requested"/"onboarding:hint_closed"
  // events, so it needs no engine-specific wiring beyond construction.
  const tutorialOverlay = new TutorialOverlay({ eventBus, onboardingManager, root: rootEl });

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
      onboardingManager,
      refreshIcons: () => shell.mountIcons(iconManager),
    });
    buildDeveloperDesktopIcons().forEach((icon) => iconManager.register(icon));
  }
  // DEV-TOOLS:END

  shell.mountIcons(iconManager);
  onboardingManager.markMilestone("desktop_seen");

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
    saveManager,
    onboardingManager,
    tutorialOverlay,
  };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    bootstrap(document.getElementById("ng-root"));
  });
}
