import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { RuntimeCollectionRegistry } from "../core/RuntimeCollectionRegistry.js";
import { EventActivityRouter } from "../core/EventActivityRouter.js";

const bus = new EventBus();
const variables = new VariableStore(bus);
const collections = new RuntimeCollectionRegistry({ eventBus: bus });
collections.loadDefinitions({
  achievements: { stateOnly: true },
  history: { stateOnly: true },
});
const started = [];
const displayed = [];
const router = new EventActivityRouter({
  eventBus: bus,
  variableStore: variables,
  runtimeGateway: collections,
  displayRegistry: { dispatch: (target, payload) => displayed.push({ target, payload }) },
  resources: { media: new Map([["cg_test", { id: "cg_test", imageData: "data:image/test" }]]) },
  runActivity: (id, queue) => started.push({ id, queue }),
  routes: [{
    event: "achievement:display",
    activityId: "achievement-handler",
    queueId: "managers",
    actions: [
      { type: "collection.set", collectionId: "achievements", recordId: { path: "achievementId" }, value: { unlocked: true } },
      { type: "collection.append", collectionId: "history", value: { kind: "achievement", id: { path: "achievementId" } } },
      { type: "display.dispatch", target: "ending-screen", displayType: "media", value: { cgId: { path: "achievementId" }, imageData: { resource: "media", id: "cg_test", field: "imageData" } } },
    ],
  }],
}).start();

bus.emit("achievement:display", { achievementId: "exam_pass" });
assert.deepEqual(collections.get("achievements"), [{ id: "exam_pass", unlocked: true }]);
assert.deepEqual(collections.get("history"), [{ id: "exam_pass", kind: "achievement" }]);
assert.deepEqual(variables.get("event:payload"), { achievementId: "exam_pass" });
assert.deepEqual(started, [{ id: "achievement-handler", queue: "managers" }]);
assert.deepEqual(displayed, [{ target: "ending-screen", payload: { cgId: "exam_pass", imageData: "data:image/test", type: "media" } }]);

const snapshot = collections.snapshot();
collections.restore({});
assert.deepEqual(collections.get("achievements"), []);
collections.restore(snapshot);
assert.deepEqual(collections.get("achievements"), [{ id: "exam_pass", unlocked: true }]);
router.stop();
console.log("event-activity-router-probe: ok");
