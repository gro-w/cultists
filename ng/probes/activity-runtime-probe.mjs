import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

const defaultDefinition = {
  id: "default",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      setInitialized: { id: "setInitialized", type: "setVariable", inputs: { key: "engine.initialized", value: true } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "setInitialized", toPort: "flowIn" },
      { fromNodeId: "setInitialized", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

const combinedDefinition = {
  id: "combined",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      initCounter: { id: "initCounter", type: "setVariable", inputs: { key: "counter", value: 0 } },
      loop: { id: "loop", type: "loop", inputs: { times: 3 } },
      incCounter: { id: "incCounter", type: "setVariable", inputs: { key: "counter", delta: 1 } },
      setEligible: { id: "setEligible", type: "setVariable", inputs: { key: "eligible", value: true } },
      branch: { id: "branch", type: "branch", inputs: { condition: { variable: "eligible" } } },
      consume: { id: "consume", type: "consumeTime", inputs: { minutes: 20 } },
      wait: { id: "wait", type: "blockUntil", inputs: { key: "approved", equals: true } },
      endTrue: { id: "endTrue", type: "activityEnd", inputs: {} },
      endFalse: { id: "endFalse", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "initCounter", toPort: "flowIn" },
      { fromNodeId: "initCounter", fromPort: "flowOut", toNodeId: "loop", toPort: "flowIn" },
      { fromNodeId: "loop", fromPort: "body", toNodeId: "incCounter", toPort: "flowIn" },
      { fromNodeId: "incCounter", fromPort: "flowOut", toNodeId: "loop", toPort: "flowIn" },
      { fromNodeId: "loop", fromPort: "done", toNodeId: "setEligible", toPort: "flowIn" },
      { fromNodeId: "setEligible", fromPort: "flowOut", toNodeId: "branch", toPort: "flowIn" },
      { fromNodeId: "branch", fromPort: "true", toNodeId: "consume", toPort: "flowIn" },
      { fromNodeId: "branch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
      { fromNodeId: "consume", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
      { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "endTrue", toPort: "flowIn" },
    ],
  },
};

function makeEngine(definitions) {
  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const activityDefinitionStore = new ActivityDefinitionStore();
  definitions.forEach((definition) => activityDefinitionStore.register(definition));
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  return { eventBus, variableStore, activityDefinitionStore, activityQueueRegistry, activityExecutionService };
}

// --- Blueprint validation ----------------------------------------------------
{
  const { ok, errors } = validateBlueprint(defaultDefinition.blueprint);
  assert.equal(ok, true, `default blueprint should validate: ${errors.join(", ")}`);

  const broken = validateBlueprint({ nodes: { a: { id: "a", type: "flowStart" } }, connections: [] });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((message) => message.includes("结束")));
}

// --- Scenario 1: default/default auto-runs on the main queue -----------------
{
  const engine = makeEngine([defaultDefinition]);
  const mainQueue = engine.activityQueueRegistry.get("main");
  const instance = mainQueue.append({ activityId: "default" });
  let completedEvents = 0;
  engine.eventBus.on(ACTIVITY_EVENTS.completed, () => completedEvents += 1);

  engine.activityExecutionService.run({
    queue: mainQueue,
    definition: engine.activityDefinitionStore.get("default"),
    instance,
    variableStore: engine.variableStore,
  });

  assert.equal(engine.variableStore.get("engine.initialized"), true);
  assert.equal(mainQueue.get(instance.instanceId).status, "resolved");
  assert.equal(completedEvents, 1);
}

// --- Scenario 2: custom setVariable succeeds on a non-main queue -------------
{
  const engine = makeEngine([defaultDefinition]);
  const queue = engine.activityQueueRegistry.register("social");
  const instance = queue.append({ activityId: "default" });
  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("default"),
    instance,
    variableStore: engine.variableStore,
  });
  assert.equal(engine.variableStore.get("engine.initialized"), true);
}

// --- Scenario 3: branch/loop/blockUntil/consumeTime, resumable across "save" -
{
  const engine = makeEngine([combinedDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "combined" });
  const timedMinutes = [];

  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("combined"),
    instance,
    variableStore: engine.variableStore,
    timeGateway: (minutes) => timedMinutes.push(minutes),
  });

  // loop ran 3 times, branch took the true path, consumeTime fired once, then blocked.
  assert.equal(engine.variableStore.get("counter"), 3);
  assert.equal(engine.variableStore.get("eligible"), true);
  assert.deepEqual(timedMinutes, [20]);
  assert.equal(queue.get(instance.instanceId).status, "unresolved");
  assert.equal(queue.get(instance.instanceId).waitingNodeId, "wait");

  // Simulate save/restore: fresh registries built purely from a snapshot.
  const snapshot = engine.activityQueueRegistry.snapshot();
  const restoredEngine = makeEngine([combinedDefinition]);
  restoredEngine.variableStore.restore(engine.variableStore.snapshot());
  restoredEngine.activityQueueRegistry.restore(snapshot);
  const restoredQueue = restoredEngine.activityQueueRegistry.get("main");
  const restoredInstance = restoredQueue.get(instance.instanceId);
  assert.equal(restoredInstance.waitingNodeId, "wait");

  let terminalCount = 0;
  restoredEngine.eventBus.on(ACTIVITY_EVENTS.completed, () => terminalCount += 1);

  restoredEngine.activityExecutionService.run({
    queue: restoredQueue,
    definition: restoredEngine.activityDefinitionStore.get("combined"),
    instance: restoredInstance,
    variableStore: restoredEngine.variableStore,
    timeGateway: (minutes) => timedMinutes.push(minutes),
  });
  // Still blocked immediately after restore: "approved" hasn't been set yet.
  assert.equal(restoredQueue.get(instance.instanceId).status, "unresolved");
  assert.equal(terminalCount, 0);
  assert.deepEqual(timedMinutes, [20], "consumeTime must not re-fire for the already-executed node");

  // Now satisfy the wait condition and confirm it resumes to completion exactly once.
  restoredEngine.variableStore.set("approved", true);
  assert.equal(restoredQueue.get(instance.instanceId).status, "resolved");
  assert.equal(terminalCount, 1);

  // Firing another unrelated variable change must not re-emit a terminal event.
  restoredEngine.variableStore.set("approved", true);
  assert.equal(terminalCount, 1);
}

// --- Scenario 4: terminal events (fail/cancel/duplicate-complete) fire once --
{
  const engine = makeEngine([combinedDefinition]);
  const queue = engine.activityQueueRegistry.get("main");
  const instance = queue.append({ activityId: "combined" });
  let cancelledCount = 0;
  engine.eventBus.on(ACTIVITY_EVENTS.cancelled, () => cancelledCount += 1);

  engine.activityExecutionService.run({
    queue,
    definition: engine.activityDefinitionStore.get("combined"),
    instance,
    variableStore: engine.variableStore,
  });
  assert.equal(queue.get(instance.instanceId).status, "unresolved"); // blocked on "approved"

  assert.equal(engine.activityExecutionService.cancel(instance.instanceId), true);
  assert.equal(cancelledCount, 1);
  assert.equal(queue.get(instance.instanceId).status, "resolved");
  assert.equal(queue.get(instance.instanceId).resolutionReason, "cancelled");

  // Cancelling an already-resolved instance is a no-op: no duplicate event, no runner to act on.
  assert.equal(engine.activityExecutionService.cancel(instance.instanceId), false);
  assert.equal(cancelledCount, 1);
  assert.equal(queue.complete(instance.instanceId), false, "queue.complete on a resolved instance is a no-op");
}

console.log("activity-runtime-probe: all scenarios passed");
