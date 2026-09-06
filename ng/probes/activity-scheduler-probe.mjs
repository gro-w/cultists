import assert from "node:assert/strict";
import { ActivityScheduler } from "../core/ActivityScheduler.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart" },
    end: { id: "end", type: "activityEnd" },
  },
  connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
};
const documents = new Map([
  ["work01a", { document: { entries: [{ id: "shift", blueprint }] } }],
  ["social01a", { document: { entries: [] } }],
]);
const contentDocumentStore = { get: (id) => documents.get(id) || null };
const definitions = new ActivityDefinitionStore({ loadJSON: async () => null });
const queues = new ActivityQueueRegistry();
queues.register("work");
queues.register("social");
const appended = [];
const scheduler = new ActivityScheduler({ contentDocumentStore, activityDefinitionStore: definitions, queueRegistry: queues, context: {}, onAppend: (event) => appended.push(event) });
scheduler.load();
scheduler.advanceTo(1, 479);
assert.equal(queues.get("work").entries.filter((entry) => entry.status === "unresolved").length, 0);
scheduler.advanceTo(1, 480);
const pending = queues.get("work").entries.filter((entry) => entry.status === "unresolved");
assert.equal(pending.length, 1);
assert.equal(pending[0].activityId, "shift");
assert.equal(pending[0].payload.id, "shift");
assert.equal(pending[0].receivedDay, 1);
assert.equal(appended.length, 1);
assert.equal(appended[0].instance.instanceId, pending[0].instanceId);
assert.equal(definitions.get("shift").blueprint.startNodeId, "start");
scheduler.advanceTo(1, 480);
assert.equal(queues.get("work").entries.filter((entry) => entry.status === "unresolved").length, 1, "slot must be idempotent");
console.log("activity-scheduler probe: ok");
