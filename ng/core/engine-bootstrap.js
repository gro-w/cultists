/**
 * NG platform entry point.
 *
 * This module contains only the four NG capabilities: desktop/windows,
 * blueprint Activities, save/restore, and the development-mode hook. Game
 * semantics are data in ng/data and are scheduled by the default Activity.
 */
import { eventBus } from "./EventBus.js";
import { DataLoader } from "./DataLoader.js";
import { WindowManager } from "./WindowManager.js";
import { WindowDefinitionStore } from "./WindowDefinitionStore.js";
import { DesktopShell } from "./desktopDesktopShell.js";
import { VariableStore } from "./VariableStore.js";
import { ActivityDefinitionStore } from "./ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "./ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./ActivityExecutionService.js";
import { ActivityQueueConsumer } from "./ActivityQueueConsumer.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";
import { validateBlueprint } from "./ActivityValidator.js";
import { GameClock } from "./GameClock.js";
import { TimeService } from "./TimeService.js";
import { DesktopIconManager } from "./DesktopIconManager.js";
import { buildBuiltinIconBlueprint } from "./BuiltinIconBlueprints.js";
import { DataStructureManager } from "./DataStructureManager.js";
import { DataStore } from "./DataStore.js";
import { PublicVariableManager } from "./PublicVariableManager.js";
import { RuntimeRefResolver } from "./RuntimeRefResolver.js";
import { SaveManager } from "./SaveManager.js";
import { EventStateRegistry } from "./EventStateRegistry.js";
import { RuntimeCollectionRegistry } from "./RuntimeCollectionRegistry.js";
import { TextChoiceWidget } from "./TextChoiceWidget.js";
import { evaluateCondition } from "./ConditionEvaluator.js";
import { evaluateActivityAvailability } from "./ActivityAvailabilityEvaluator.js";
import { DisplayReceiverRegistry } from "./DisplayReceiverRegistry.js";
import { registerCustomActivityNode } from "./ActivityNodeRegistry.js";
import { createApiRegistry } from "./engine-api.js";

export function isDevEntry(search = typeof location !== "undefined" ? location.search : "") {
  return search === "?dev";
}

export async function bootstrap(rootEl) {
  const dataLoader = new DataLoader();
  const coreLoader = new DataLoader({ root: "" });
  const windowManager = new WindowManager(eventBus);
  const windowDefinitions = new WindowDefinitionStore(dataLoader);
  const config = await dataLoader.loadJSON("game-manifest.json");
  if (config.contentRoot) dataLoader.setRoot(config.contentRoot);
  const frameworkManifest = await dataLoader.loadJSON(config.frameworkManifest, { optional: true }) || {};
  if (isDevEntry() && await dataLoader.detectDevServer()) {
    dataLoader.connectChangeEvents({ onChange: (payload) => eventBus.emit("data:changed", payload) });
  }
  await windowDefinitions.loadManifest(config.windowManifest, "windows/");
  const icons = await dataLoader.loadJSON(config.desktopIcons, { optional: true }) || [];
  const customBlueprintNodes = await dataLoader.loadJSON(frameworkManifest.documents?.blueprintNodes || config.blueprintNodes, { optional: true }) || [];
  customBlueprintNodes.forEach((node) => registerCustomActivityNode(node));
  const initialState = config.initialState || {};
  const gameClock = new GameClock(eventBus, {
    day: initialState.day,
    minutes: initialState.clockMinutes ?? initialState.minutes ?? 480,
  });
  const timeService = new TimeService(gameClock, eventBus);
  const variableStore = new VariableStore(eventBus);
  const structures = new DataStructureManager();
  const dataStore = new DataStore(structures);
  const refResolver = new RuntimeRefResolver();
  const publicVariables = new PublicVariableManager(refResolver, eventBus);
  variableStore.publicVariableGateway = publicVariables;
  const eventStateConfig = frameworkManifest.documents?.eventState || {};
  const eventState = new EventStateRegistry({ eventBus, events: eventStateConfig.events });
  if (eventStateConfig.data || config.onboarding) {
    const definitions = await dataLoader.loadJSON(eventStateConfig.data || config.onboarding, { optional: true });
    if (definitions) eventState.loadDefinitions(definitions);
  }
  if (frameworkManifest.documents?.structures || config.structures) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.structures || config.structures, { optional: true });
    if (value) structures.loadDefinitions(value);
  }
  if (frameworkManifest.documents?.databases || config.databases) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.databases || config.databases, { optional: true });
    if (value) dataStore.loadDefinitions(value);
  }
  if (frameworkManifest.documents?.publicVariables || config.publicVariables) {
    const value = await dataLoader.loadJSON(frameworkManifest.documents?.publicVariables || config.publicVariables, { optional: true });
    if (value) publicVariables.loadDefinitions(value);
  }
  publicVariables.registerSyncSource("gameClock.totalMinutes", () => (gameClock.day - 1) * 1440 + gameClock.minutes);
  eventBus.on("gameClock:changed", () => publicVariables.syncFromSources());
  const seedFiles = [
    ...(config.seedRecords ? (Array.isArray(config.seedRecords) ? config.seedRecords : [config.seedRecords]) : []),
    ...(config.deferredSeedRecords ? (Array.isArray(config.deferredSeedRecords) ? config.deferredSeedRecords : [config.deferredSeedRecords]) : []),
  ];
  for (const file of seedFiles) {
    const value = await dataLoader.loadJSON(file, { optional: true });
    if (value) dataStore.loadRecordSet(value);
  }
  for (const { databaseId } of dataStore.listDatabases()) {
    refResolver.register(`database:${databaseId}`, (key) => dataStore.getRecord(databaseId, key));
  }
  const frameworkRuntimeDefinition = await dataLoader.loadJSON(frameworkManifest.documents?.runtimeCollections || config.frameworkCollections, { optional: true }) || {};
  const runtimeCollections = new RuntimeCollectionRegistry({ dataStore, eventBus });
  runtimeCollections.loadDefinitions(frameworkRuntimeDefinition.collections || {});
  const runtimeGateway = {
    getCollection: (collectionId) => runtimeCollections.get(collectionId),
    setCollectionValue: (collectionId, recordId, value) => runtimeCollections.set(collectionId, recordId, value),
  };
  const content = {
    runtimeGateway,
    customWidgetFactories: { display: TextChoiceWidget, dialogue: TextChoiceWidget },
    stateProviders: {},
    runtimeStores: { runtimeCollections },
    saveableVariable: (key, value) => {
      const excluded = frameworkRuntimeDefinition.saveableVariableExclusions || [];
      const prefixes = frameworkRuntimeDefinition.saveableVariablePrefixes || [];
      return !excluded.includes(key) && !prefixes.some((prefix) => String(key).startsWith(prefix))
        && (value === null || ["boolean", "number", "string"].includes(typeof value));
    },
  };
  const iconManager = new DesktopIconManager(icons);
  // This ID is reserved by the engine. Ignore stale content/save data so the
  // developer entry can never be supplied or configured by the game package.
  iconManager.unregister("dev-mode-launcher-icon");
  const dialogueRegistry = new DisplayReceiverRegistry();
  content.installDisplayReceivers?.({ dialogueRegistry });
  const shell = new DesktopShell(windowManager, windowDefinitions, eventBus, rootEl, gameClock, variableStore, publicVariables, dataStore, runtimeGateway, dialogueRegistry, content.customWidgetFactories);
  // Paint icons before loading the Activity catalogue. The catalogue can be
  // large; taskbar and desktop must become visible as one initial surface.
  shell.mountIcons(iconManager);
  // DEV-TOOLS:START
  if (isDevEntry()) {
    iconManager.register({
      iconId: "dev-mode-launcher-icon",
      glyph: "🛠️",
      label: "开发人员模式",
      blueprintId: "desktop.open-window",
      inputs: { windowId: "dev-mode-launcher" },
      engineOwned: true,
    });
    shell.refreshIcons();
  }
  // DEV-TOOLS:END
  const activityDefinitions = new ActivityDefinitionStore(dataLoader);
  const manifest = await dataLoader.loadJSON(config.activityManifest, { optional: true }) || { activityIds: [] };
  const manifestEntries = new Map((manifest.activityIds || []).map((entry) => {
    const value = typeof entry === "string" ? { id: entry, file: `${entry}.json` } : entry;
    return [value.id, value];
  }));
  const ids = new Set();
  for (const listFile of config.activityLists || []) {
    const list = await dataLoader.loadJSON(`activity-lists/${listFile}`, { optional: true });
    for (const id of list?.activityIds || []) ids.add(id);
  }
  const defaultId = config.defaultActivity?.activityId || "default";
  ids.add(defaultId);
  const entries = [...ids].map((id) => manifestEntries.get(id)).filter(Boolean);
  if (entries.length) await activityDefinitions.loadManifest(entries, "activities/");

  const queues = new ActivityQueueRegistry();
  for (const definition of config.queues || []) {
    if (definition?.id) queues.register(definition.id, { nonBlocking: Boolean(definition.nonBlocking) });
  }
  const saveManager = new SaveManager({
    gameClock, variableStore, publicVariableManager: publicVariables,
    activityQueueRegistry: queues, windowManager, desktopIconManager: iconManager,
    eventStateRegistry: eventState, stateProviders: content.stateProviders, runtimeStores: content.runtimeStores,
    saveableVariable: content.saveableVariable,
    activityExecutionService: null, resumePendingActivities: () => {}, engineVersion: config.version,
  });
  const apiGateway = createApiRegistry({ eventBus, variableStore, publicVariableManager: publicVariables, activityQueueRegistry: queues, shell, timeService, dataStore });
  const execution = new ActivityExecutionService(eventBus, { runtimeGateway });

  apiGateway.register("window.componentMutation", ({ componentId, action, max = 5 } = {}) => {
    const allowed = new Set(["add", "remove"]);
    if (!componentId || !allowed.has(action)) return { ok: false, reason: "invalid-component-mutation" };
    eventBus.emit("window:componentMutation", { componentId, action, max: Math.min(5, Math.max(1, Number(max) || 5)) });
    return { ok: true, componentId, action, max: Math.min(5, Math.max(1, Number(max) || 5)) };
  });
  apiGateway.register("window.addComponent", (payload = {}) => shell.addWindowComponent(payload));
  apiGateway.register("window.removeComponent", (payload = {}) => shell.removeWindowComponent(payload));
  apiGateway.register("window.getLayout", (payload = {}) => shell.getWindowLayout(payload));
  saveManager.activityExecutionService = execution;
  const consumer = new ActivityQueueConsumer({ queueRegistry: queues, activityDefinitionStore: activityDefinitions, activityExecutionService: execution, execute: (context) => executeActivity(context) });
  apiGateway.register("engine.queue.consume", ({ queueId = "main" }) => Boolean(consumer.consume(queueId)));
  apiGateway.register("engine.activity.pause", ({ instanceId }) => execution.pause(instanceId));
  apiGateway.register("engine.activity.resume", ({ instanceId }) => execution.resume(instanceId));
  apiGateway.register("engine.activity.cancel", ({ instanceId }) => execution.cancel(instanceId));

  function enqueueActivity(activityId, queueId = "main", payload = null) {
    const queue = queues.get(queueId) || queues.register(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!definition) return null;
    const instance = queue.append({ activityId, payload, currentNodeId: definition.blueprint?.startNodeId || null });
    eventBus.emit(ACTIVITY_EVENTS.appended, { queueId, instance: { ...instance } });
    return instance;
  }
  function runActivity(activityId, queueId = "main") {
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] runActivity requested", { activityId, queueId, hasQueue: Boolean(queues.get(queueId)), hasDefinition: Boolean(activityDefinitions.get(activityId)) });
    /* DEV-TOOLS:END */
    const queue = queues.get(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!queue || !definition) {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] runActivity rejected", { activityId, queueId, hasQueue: Boolean(queue), hasDefinition: Boolean(definition) });
      /* DEV-TOOLS:END */
      return null;
    }
    const availability = evaluateActivityAvailability(definition, { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions, evaluateCondition });
    if (!availability.ok) {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] runActivity unavailable", { activityId, queueId, availability });
      /* DEV-TOOLS:END */
      return null;
    }
    const instance = queue.append({ activityId });
    const runner = executeActivity({ queue, definition, instance });
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] runActivity started", { activityId, queueId, instanceId: instance.instanceId, runner: Boolean(runner) });
    /* DEV-TOOLS:END */
    return runner;
  }
  content.bindRuntime?.({ runActivity });
  function executeActivity({ queue, definition, instance }) {
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] executeActivity", { activityId: definition?.id, queueId: queue?.queueId, instanceId: instance?.instanceId, currentNodeId: instance?.currentNodeId });
    /* DEV-TOOLS:END */
    return execution.run({
      queue, definition, instance, variableStore,
      timeGateway: (minutes) => timeService.consume(minutes, { source: "activity" }),
      windowGateway: (id) => shell.openWindow(id),
      activityGateway: (id, target, source, node, payload) => node?.type === "insertActivity" ? enqueueActivity(id, target || "main", payload) : runActivity(id, target || "main"),
        eventGateway: (name, payload) => {
        /* DEV-TOOLS:START */
        console.log("[NG dialogue] eventGateway", name, payload);
        /* DEV-TOOLS:END */
        eventBus.emit(name, payload);
      }, dbGateway: dataStore,
      pvGateway: publicVariables, eventStateGateway: eventState, apiGateway,
    });
  }
  function runInlineBlueprint(queue, activityId, blueprint) {
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) throw new Error(`Invalid blueprint ${activityId}: ${validation.errors.join("；")}`);
    const instance = queue.append({ activityId });
    return executeActivity({ queue, definition: { id: activityId, blueprint: validation.blueprint }, instance });
  }
  content.registerApis?.(apiGateway, { activityDefinitionStore: activityDefinitions, enqueueActivity });
  function findWidget(root, widgetId) {
    if (!root) return null;
    if (root.widgetId === widgetId) return root;
    for (const child of root.children || []) {
      const found = findWidget(child, widgetId);
      if (found) return found;
    }
    return null;
  }
  const windowEventsQueue = queues.get("window-events");
  const widgetEventsQueue = queues.get("widget-events");
  const iconEventsQueue = queues.get("desktop-icons");
  function runWindowLifecycle(windowId, eventName) {
    const blueprint = windowDefinitions.get(windowId)?.events?.[eventName];
    return blueprint ? runInlineBlueprint(windowEventsQueue, `window:${windowId}:${eventName}`, blueprint) : null;
  }
  function runWidgetEvent(windowId, widgetId, eventName, value) {
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget event", { windowId, widgetId, eventName, value });
    /* DEV-TOOLS:END */
    const widget = findWidget(shell.getRuntimeRoot?.(windowId) || windowDefinitions.get(windowId)?.root, widgetId);
    const blueprint = widget?.events?.[eventName];
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget blueprint lookup", { windowId, widgetId, eventName, foundWidget: Boolean(widget), foundBlueprint: Boolean(blueprint) });
    /* DEV-TOOLS:END */
    if (!blueprint) return null;
    if (value !== undefined) variableStore.set("event:value", value);
    return runInlineBlueprint(widgetEventsQueue, `widget:${windowId}:${widgetId}:${eventName}`, blueprint);
  }
  function runIconBlueprint(icon) {
    const builtin = buildBuiltinIconBlueprint(icon.blueprintId, icon.inputs || {});
    if (builtin) return runInlineBlueprint(iconEventsQueue, `icon:${icon.iconId}`, builtin);
    return runActivity(icon.blueprintId, "desktop-icons");
  }
  shell.runWidgetEvent = runWidgetEvent;
  shell.saveManager = saveManager;
  shell.runIconBlueprint = runIconBlueprint;
  eventBus.on("window:opened", ({ windowId }) => runWindowLifecycle(windowId, "onCreate"));
  eventBus.on("window:closed", ({ windowId }) => runWindowLifecycle(windowId, "onDestroy"));
  shell.runActivity = runActivity;
  shell.conditionContext = { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions };
  shell.refreshIcons();

  // DEV-TOOLS:START
  if (isDevEntry()) {
    const { initDeveloperMode } = await import("../dev/DeveloperMode.js");
    await initDeveloperMode({
      engineConfig: config,
      activityManifest: manifest,
      windowManager,
      windowDefinitionStore: windowDefinitions,
      activityQueueRegistry: queues,
      activityDefinitionStore: activityDefinitions,
      eventBus,
      variableStore,
      pvGateway: publicVariables,
      dbGateway: dataStore,
      runtimeGateway,
      iconManager,
      dataStructureManager: structures,
      dataStore,
      publicVariableManager: publicVariables,
      eventStateRegistry: eventState,
      dataLoader,
      saveManager,
      refreshIcons: () => shell.refreshIcons(),
    });
    shell.refreshIcons();
  }
  // DEV-TOOLS:END

  eventBus.emit("engine:ready", {});
  const startup = config.defaultActivity;
  if (startup) {
    const instance = enqueueActivity(startup.activityId, startup.queueId || "main");
    if (instance) consumer.consume(startup.queueId || "main");
  }
  return { eventBus, windowManager, windowDefinitionStore: windowDefinitions, shell, variableStore, contentPackage: content, activityDefinitionStore: activityDefinitions, activityQueueRegistry: queues, activityExecutionService: execution, activityQueueConsumer: consumer, activityApi: { enqueue: enqueueActivity, run: runActivity, read: (q, id) => queues.getEntry(q, id), list: (q, f) => queues.listEntries(q, f), update: (q, id, p) => queues.updateEntry(q, id, p), complete: (q, id) => queues.completeEntry(q, id), cancel: (q, id) => queues.cancelEntry(q, id), consume: (q) => consumer.consume(q), callApi: (id, payload) => apiGateway.call(id, payload), apis: () => apiGateway.list() }, dataLoader, dataStore, dataStructureManager: structures, publicVariableManager: publicVariables, gameClock, timeService, iconManager, saveManager, eventStateRegistry: eventState };
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => bootstrap(document.getElementById("ng-root")));
