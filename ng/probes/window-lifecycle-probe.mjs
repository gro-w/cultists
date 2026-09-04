import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EventBus from "../core/EventBus.js";
import { WindowManager } from "../core/WindowManager.js";
import { WindowDefinitionStore } from "../core/WindowDefinitionStore.js";
import { VariableStore } from "../core/VariableStore.js";
import { GameClock } from "../core/GameClock.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal stand-in for engine.js's window-lifecycle wiring (plan §4.2):
 * every window's `events.onCreate`/`onDestroy` inline blueprint runs
 * through the shared ActivityExecutionService whenever WindowManager emits
 * `window:opened`/`window:closed`, on a dedicated non-blocking queue.
 */
function wireWindowLifecycle({ eventBus, windowDefinitionStore, activityQueueRegistry, activityExecutionService, variableStore, gameClock }) {
  const windowEventsQueue = activityQueueRegistry.register("window-events", { nonBlocking: true });
  function runWindowLifecycleEvent(windowId, eventName) {
    const definition = windowDefinitionStore.get(windowId);
    const blueprint = definition?.events?.[eventName];
    if (!blueprint) return null;
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) return null;
    const activityId = `window:${windowId}:${eventName}`;
    const instance = windowEventsQueue.append({ activityId });
    return activityExecutionService.run({
      queue: windowEventsQueue,
      definition: { id: activityId, blueprint: validation.blueprint },
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      windowGateway: () => {},
    });
  }
  eventBus.on("window:opened", ({ windowId }) => runWindowLifecycleEvent(windowId, "onCreate"));
  eventBus.on("window:closed", ({ windowId }) => runWindowLifecycleEvent(windowId, "onDestroy"));
  return { windowEventsQueue };
}

function buildHarness() {
  const eventBus = new EventBus();
  const windowManager = new WindowManager(eventBus, { storage: { getItem: () => null, setItem: () => {} } });
  const windowDefinitionStore = new WindowDefinitionStore();
  const variableStore = new VariableStore(eventBus);
  const gameClock = new GameClock(eventBus);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  wireWindowLifecycle({ eventBus, windowDefinitionStore, activityQueueRegistry, activityExecutionService, variableStore, gameClock });
  return { eventBus, windowManager, windowDefinitionStore, variableStore, gameClock };
}

// --- a window with no `events` at all is unaffected (no crash, no-op) ------
{
  const { windowManager, windowDefinitionStore, gameClock } = buildHarness();
  windowDefinitionStore.register({ id: "plain", title: "Plain" });
  const state = windowManager.open({ id: "plain" });
  assert.equal(gameClock.snapshot().day, 1);
  assert.equal(gameClock.snapshot().minutes, 0);
  windowManager.close(state.instanceId);
}

// --- onCreate runs exactly once when the window opens, onDestroy once on close --
{
  const { windowManager, windowDefinitionStore, variableStore, gameClock } = buildHarness();
  windowDefinitionStore.register({
    id: "lifecycle-test",
    title: "Lifecycle",
    events: {
      onCreate: {
        startNodeId: "start",
        nodes: {
          start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "set", port: "flowIn" } } },
          set: { id: "set", type: "setVariable", inputs: { key: "opened", value: true }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
          end: { id: "end", type: "activityEnd", inputs: {} },
        },
      },
      onDestroy: {
        startNodeId: "start",
        nodes: {
          start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "set", port: "flowIn" } } },
          set: { id: "set", type: "setVariable", inputs: { key: "opened", value: false }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
          end: { id: "end", type: "activityEnd", inputs: {} },
        },
      },
    },
  });
  const state = windowManager.open({ id: "lifecycle-test" });
  assert.equal(variableStore.get("opened"), true, "onCreate ran on open");
  windowManager.close(state.instanceId);
  assert.equal(variableStore.get("opened"), false, "onDestroy ran on close");
  assert.equal(gameClock.snapshot().minutes, 0, "no time advance unless the blueprint says so");
}

// --- off-duty.json's real data file: opening it advances the clock by 480
// minutes via its own onCreate blueprint, not the desktop icon's blueprint --
{
  const { windowManager, windowDefinitionStore, gameClock } = buildHarness();
  const offDuty = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/windows/off-duty.json"), "utf8"));
  windowDefinitionStore.register(offDuty);
  windowManager.open(offDuty);
  const snapshot = gameClock.snapshot();
  assert.equal(snapshot.day, 1);
  assert.equal(snapshot.minutes, 480, "off-duty's own onCreate blueprint advances time by 8 hours");
}

// --- off-duty-open.json's icon Activity now only opens the window; it must
// no longer contain its own consumeTime node (that responsibility moved) --
{
  const offDutyOpen = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/activities/off-duty-open.json"), "utf8"));
  const nodeTypes = Object.values(offDutyOpen.blueprint.nodes).map((node) => node.type);
  assert.ok(!nodeTypes.includes("consumeTime"), "off-duty-open no longer advances time itself");
  assert.ok(nodeTypes.includes("openWindow"));
}

console.log("window-lifecycle-probe: all scenarios passed");
