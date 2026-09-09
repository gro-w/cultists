/**
 * NG platform entry point.
 *
 * This module contains only the four NG capabilities: desktop/windows,
 * blueprint Activities, save/restore, and the development-mode hook. Game
 * semantics are data in ng/data and are scheduled by the default Activity.
 */
import { eventBus } from "./core/EventBus.js";
import { DataLoader } from "./core/DataLoader.js";
import { WindowManager } from "./core/WindowManager.js";
import { WindowDefinitionStore } from "./core/WindowDefinitionStore.js";
import { DesktopShell } from "./desktop/DesktopShell.js";
import { VariableStore } from "./core/VariableStore.js";
import { ActivityDefinitionStore } from "./core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "./core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./core/ActivityExecutionService.js";
import { ActivityQueueConsumer } from "./core/ActivityQueueConsumer.js";
import { ACTIVITY_EVENTS } from "./core/ActivityEvents.js";
import { validateBlueprint } from "./core/ActivityValidator.js";
import { GameClock } from "./core/GameClock.js";
import { TimeService } from "./core/TimeService.js";
import { DesktopIconManager } from "./core/DesktopIconManager.js";
import { buildBuiltinIconBlueprint } from "./core/BuiltinIconBlueprints.js";
import { DataStructureManager } from "./core/DataStructureManager.js";
import { DataStore } from "./core/DataStore.js";
import { PublicVariableManager } from "./core/PublicVariableManager.js";
import { RuntimeRefResolver } from "./core/RuntimeRefResolver.js";
import { SaveManager } from "./core/SaveManager.js";
import { OnboardingManager } from "./core/OnboardingManager.js";
import { evaluateCondition } from "./core/ConditionEvaluator.js";
import { evaluateActivityAvailability } from "./core/ActivityAvailabilityEvaluator.js";
import { DisplayReceiverRegistry } from "./core/DisplayReceiverRegistry.js";
import { registerCustomActivityNode } from "./core/ActivityNodeRegistry.js";

export function isDevEntry(search = typeof location !== "undefined" ? location.search : "") {
  return search === "?dev";
}

function createApiRegistry({ eventBus: bus, variableStore, publicVariableManager, activityQueueRegistry, shell, timeService, dataStore }) {
  const handlers = new Map([
    ["engine.getVariable", ({ key }) => variableStore.get(key)],
    ["engine.setVariable", ({ key, value }) => (variableStore.set(key, value), value)],
    ["engine.getPublicVariable", ({ id }) => publicVariableManager.get(id)],
    ["engine.setPublicVariable", ({ id, value }) => (publicVariableManager.set(id, value), value)],
    ["engine.emit", ({ event, payload }) => (bus.emit(event, payload), true)],
    ["engine.consumeTime", ({ minutes }) => timeService.consume(Number(minutes) || 0, { source: "activity" })],
    ["engine.records", ({ databaseId, query = {} }) => dataStore.findRecords(databaseId, query)],
    ["engine.queue.list", ({ queueId = "main", filters }) => activityQueueRegistry.listEntries(queueId, filters)],
    ["engine.queue.listQueues", () => activityQueueRegistry.listQueues()],
    ["engine.queue.get", ({ queueId = "main", instanceId }) => activityQueueRegistry.getEntry(queueId, instanceId)],
    ["engine.queue.append", ({ queueId = "main", ...options }) => activityQueueRegistry.append(queueId, options)],
    ["engine.queue.update", ({ queueId = "main", instanceId, patch }) => activityQueueRegistry.updateEntry(queueId, instanceId, patch)],
    ["engine.queue.complete", ({ queueId = "main", instanceId }) => activityQueueRegistry.completeEntry(queueId, instanceId)],
    ["engine.queue.cancel", ({ queueId = "main", instanceId }) => activityQueueRegistry.cancelEntry(queueId, instanceId)],
    ["engine.queue.remove", ({ queueId = "main", instanceId }) => activityQueueRegistry.removeEntry(queueId, instanceId)],
    ["engine.openWindow", ({ windowId }) => (shell.openWindow(windowId), true)],
  ]);
  return {
    call(apiId, payload = {}) {
      const handler = handlers.get(apiId);
      if (!handler) throw new Error(`Unknown engine API: ${apiId}`);
      return handler(payload);
    },
    list() { return [...handlers.keys()]; },
    register(apiId, handler) { handlers.set(apiId, handler); },
  };
}

export async function bootstrap(rootEl) {
  const dataLoader = new DataLoader();
  const windowManager = new WindowManager(eventBus);
  const windowDefinitions = new WindowDefinitionStore(dataLoader);
  const config = await dataLoader.loadJSON("engine.json");
  if (config.contentRoot) dataLoader.setRoot(config.contentRoot);
  if (isDevEntry() && await dataLoader.detectDevServer()) {
    dataLoader.connectChangeEvents({ onChange: (payload) => eventBus.emit("data:changed", payload) });
  }
  await windowDefinitions.loadManifest(config.windowManifest, "windows/");
  const icons = await dataLoader.loadJSON(config.desktopIcons, { optional: true }) || [];
  const customBlueprintNodes = await dataLoader.loadJSON(config.blueprintNodes, { optional: true }) || [];
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
  const onboarding = new OnboardingManager({ eventBus });
  if (config.onboarding) {
    const hints = await dataLoader.loadJSON(config.onboarding, { optional: true });
    if (hints) onboarding.loadHints(hints);
  }
  if (config.structures) {
    const value = await dataLoader.loadJSON(config.structures, { optional: true });
    if (value) structures.loadDefinitions(value);
  }
  if (config.databases) {
    const value = await dataLoader.loadJSON(config.databases, { optional: true });
    if (value) dataStore.loadDefinitions(value);
  }
  if (config.publicVariables) {
    const value = await dataLoader.loadJSON(config.publicVariables, { optional: true });
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
  const contentModule = config.contentPackage || "cultists.js";
  const { createContentPackage } = await import(`./content/${contentModule}`);
  const content = createContentPackage({ eventBus, dataStore, publicVariables, variableStore });
  const { keywordManager, runtimeGateway, customWidgetFactories = {} } = content;
  const iconManager = new DesktopIconManager(icons);
  // This ID is reserved by the engine. Ignore stale content/save data so the
  // developer entry can never be supplied or configured by the game package.
  iconManager.unregister("dev-mode-launcher-icon");
  const dialogueRegistry = new DisplayReceiverRegistry();
  content.installDisplayReceivers?.({ dialogueRegistry });
  const shell = new DesktopShell(windowManager, windowDefinitions, eventBus, rootEl, gameClock, variableStore, publicVariables, dataStore, runtimeGateway, dialogueRegistry, keywordManager, customWidgetFactories);
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
    onboardingManager: onboarding, stateProviders: content.stateProviders, runtimeStores: content.runtimeStores,
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
      pvGateway: publicVariables, onboardingGateway: onboarding, apiGateway,
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
    const { initDeveloperMode } = await import("./dev/DeveloperMode.js");
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
      onboardingManager: onboarding,
      dataLoader,
      saveManager,
      customBlueprintNodes,
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
  return { eventBus, windowManager, windowDefinitionStore: windowDefinitions, shell, variableStore, contentPackage: content, activityDefinitionStore: activityDefinitions, activityQueueRegistry: queues, activityExecutionService: execution, activityQueueConsumer: consumer, activityApi: { enqueue: enqueueActivity, run: runActivity, read: (q, id) => queues.getEntry(q, id), list: (q, f) => queues.listEntries(q, f), update: (q, id, p) => queues.updateEntry(q, id, p), complete: (q, id) => queues.completeEntry(q, id), cancel: (q, id) => queues.cancelEntry(q, id), consume: (q) => consumer.consume(q), callApi: (id, payload) => apiGateway.call(id, payload), apis: () => apiGateway.list() }, dataLoader, dataStore, dataStructureManager: structures, publicVariableManager: publicVariables, gameClock, timeService, iconManager, saveManager, onboardingManager: onboarding };
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => bootstrap(document.getElementById("ng-root")));
