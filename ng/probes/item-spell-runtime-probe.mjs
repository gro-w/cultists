import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { createApiRegistry } from "../core/engine-api.js";
import fs from "node:fs";

const bus = new EventBus();
const collections = new RuntimeCollectionRegistry({ eventBus: bus });
collections.loadDefinitions({ inventoryItems: { stateOnly: true }, sceneItems: { stateOnly: true }, spellState: { stateOnly: true } });
collections.operation("inventoryItems", "medicine", { operation: "set", value: 1 });
const failed = collections.operation("inventoryItems", "medicine", { operation: "delta", value: -2, minimum: 0 });
assert.equal(failed.ok, false);
assert.deepEqual(collections.get("inventoryItems"), [{ id: "medicine", value: 1 }]);
const used = collections.operation("inventoryItems", "medicine", { operation: "delta", value: -1, minimum: 0 });
assert.equal(used.ok, true);
const learned = collections.operation("spellState", "book_nahan__0", { operation: "setIfAbsent", value: { learned: true } });
assert.equal(learned.ok, true);
const duplicate = collections.operation("spellState", "book_nahan__0", { operation: "setIfAbsent", value: { learned: true } });
assert.equal(duplicate.ok, false);
const snapshot = collections.snapshot();
collections.restore({});
assert.deepEqual(collections.get("spellState"), []);
collections.restore(snapshot);
assert.deepEqual(collections.get("spellState"), [{ id: "book_nahan__0", learned: true }]);

let san = 10;
const api = createApiRegistry({
  eventBus: bus,
  variableStore: { get() {}, set() {} },
  publicVariableManager: { get: () => san, set: (id, value) => { san = value; } },
  activityQueueRegistry: { listEntries() {}, listQueues() {}, getEntry() {}, append() {}, updateEntry() {}, completeEntry() {}, cancelEntry() {}, removeEntry() {} },
  shell: { openWindow() {} }, timeService: { consume() {} }, dataStore: { findRecords() {} },
  runtimeGateway: { operateCollection: (...args) => collections.operation(...args) },
});
assert.equal(api.call("engine.publicVariableOperation", { id: 1, operation: "delta", value: -15, minimum: 0 }).ok, false);
assert.equal(san, 10);
assert.equal(api.call("engine.publicVariableOperation", { id: 1, operation: "delta", value: -5, minimum: 0 }).ok, true);
assert.equal(san, 5);

const learnText = fs.readFileSync(new URL("../data/activities/spell-learn.json", import.meta.url), "utf8");
const learn = JSON.parse(learnText).blueprint;
const types = Object.values(learn.nodes).map((node) => node.type);
assert.ok(types.includes("framework:consumeTime"));
assert.ok(learn.connections.find((edge) => edge.fromNodeId === "time" && edge.toNodeId === "learn"));
console.log("item-spell-runtime-probe: ok");
