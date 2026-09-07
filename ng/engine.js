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

export function isDevEntry(search = typeof location !== "undefined" ? location.search : "") {
  return search === "?dev";
}

class EmptySnapshotStore {
  snapshot() { return {}; }
  restore() {}
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
    ["engine.openWindow", ({ windowId }) => (shell.openWindow(windowId), true)],
  ]);
  return {
    call(apiId, payload = {}) {
      const handler = handlers.get(apiId);
      if (!handler) throw new Error(`Unknown engine API: ${apiId}`);
      return handler(payload);
    },
    list() { return [...handlers.keys()]; },
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
  const seedFiles = config.seedRecords ? (Array.isArray(config.seedRecords) ? config.seedRecords : [config.seedRecords]) : [];
  for (const file of seedFiles) {
    const value = await dataLoader.loadJSON(file, { optional: true });
    if (value) dataStore.loadRecordSet(value);
  }
  for (const { databaseId } of dataStore.listDatabases()) {
    refResolver.register(`database:${databaseId}`, (key) => dataStore.getRecord(databaseId, key));
  }

  const runtimeGateway = { getCollection: () => [] };
  const shell = new DesktopShell(windowManager, windowDefinitions, eventBus, rootEl, gameClock, variableStore, publicVariables, dataStore, runtimeGateway);
  const iconManager = new DesktopIconManager(icons);
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
  const saveState = new EmptySnapshotStore();
  const saveManager = new SaveManager({
    gameClock, gameState: saveState, variableStore, publicVariableManager: publicVariables,
    activityQueueRegistry: queues, windowManager, desktopIconManager: iconManager,
    keywordManager: saveState, onboardingManager: onboarding, runtimeStores: {},
    activityExecutionService: null, resumePendingActivities: () => {}, engineVersion: config.version,
  });
  const apiGateway = createApiRegistry({ eventBus, variableStore, publicVariableManager: publicVariables, activityQueueRegistry: queues, shell, timeService, dataStore });
  const execution = new ActivityExecutionService(eventBus, { runtimeGateway });
  const consumer = new ActivityQueueConsumer({ queueRegistry: queues, activityDefinitionStore: activityDefinitions, activityExecutionService: execution, execute: (context) => executeActivity(context) });

  function enqueueActivity(activityId, queueId = "main", payload = null) {
    const queue = queues.get(queueId) || queues.register(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!definition) return null;
    const instance = queue.append({ activityId, payload, currentNodeId: definition.blueprint?.startNodeId || null });
    eventBus.emit(ACTIVITY_EVENTS.appended, { queueId, instance: { ...instance } });
    return instance;
  }
  function runActivity(activityId, queueId = "main") {
    const queue = queues.get(queueId);
    const definition = activityDefinitions.get(activityId);
    if (!queue || !definition) return null;
    const availability = evaluateActivityAvailability(definition, { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions, evaluateCondition });
    if (!availability.ok) return null;
    const instance = queue.append({ activityId });
    return executeActivity({ queue, definition, instance });
  }
  function executeActivity({ queue, definition, instance }) {
    return execution.run({
      queue, definition, instance, variableStore,
      timeGateway: (minutes) => timeService.consume(minutes, { source: "activity" }),
      windowGateway: (id) => shell.openWindow(id),
      activityGateway: (id, target, source, node, payload) => node?.type === "insertActivity" ? enqueueActivity(id, target || "main", payload) : runActivity(id, target || "main"),
      eventGateway: (name, payload) => eventBus.emit(name, payload), dbGateway: dataStore,
      pvGateway: publicVariables, onboardingGateway: onboarding, apiGateway,
    });
  }
  function runInlineBlueprint(queue, activityId, blueprint) {
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) throw new Error(`Invalid blueprint ${activityId}: ${validation.errors.join("；")}`);
    const instance = queue.append({ activityId });
    return executeActivity({ queue, definition: { id: activityId, blueprint: validation.blueprint }, instance });
  }
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
    const widget = findWidget(windowDefinitions.get(windowId)?.root, widgetId);
    const blueprint = widget?.events?.[eventName];
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
  shell.runIconBlueprint = runIconBlueprint;
  eventBus.on("window:opened", ({ windowId }) => runWindowLifecycle(windowId, "onCreate"));
  eventBus.on("window:closed", ({ windowId }) => runWindowLifecycle(windowId, "onDestroy"));
  shell.runActivity = runActivity;
  shell.conditionContext = { gameClock, variableStore, publicVariableManager: publicVariables, pvGateway: publicVariables, activityQueueRegistry: queues, activityDefinitionStore: activityDefinitions };
  shell.mountIcons(iconManager);
  eventBus.emit("engine:ready", {});
  const startup = config.defaultActivity;
  if (startup) {
    const instance = enqueueActivity(startup.activityId, startup.queueId || "main");
    if (instance) consumer.consume(startup.queueId || "main");
  }
  return { eventBus, windowManager, windowDefinitionStore: windowDefinitions, shell, variableStore, activityDefinitionStore: activityDefinitions, activityQueueRegistry: queues, activityExecutionService: execution, activityQueueConsumer: consumer, activityApi: { enqueue: enqueueActivity, run: runActivity, read: (q, id) => queues.getEntry(q, id), list: (q, f) => queues.listEntries(q, f), update: (q, id, p) => queues.updateEntry(q, id, p), complete: (q, id) => queues.completeEntry(q, id), cancel: (q, id) => queues.cancelEntry(q, id), consume: (q) => consumer.consume(q), callApi: (id, payload) => apiGateway.call(id, payload), apis: () => apiGateway.list() }, dataLoader, dataStore, dataStructureManager: structures, publicVariableManager: publicVariables, gameClock, timeService, iconManager, saveManager, onboardingManager: onboarding };
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => bootstrap(document.getElementById("ng-root")));
