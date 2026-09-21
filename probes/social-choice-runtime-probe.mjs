import fs from "node:fs";
import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { parseCl2 } from "../core/Cl2Parser.js";
import "./register-framework-nodes.mjs";

const bus = new EventBus();
const variables = new VariableStore(bus);
const queues = new ActivityQueueRegistry();
const queue = queues.register("social", { nonBlocking: true });
const execution = new ActivityExecutionService(bus);
const graph = parseCl2(
  fs.readFileSync("data/activities/social01b_ajie_honor_of_kings.CL2.txt", "utf8"),
  { validate: true },
).graph;
const events = [];
const instance = queue.append({ activityId: "social-choice-probe" });
execution.run({
  queue,
  definition: { id: "social-choice-probe", blueprint: graph },
  instance,
  variableStore: variables,
  timeGateway: () => {},
  windowGateway: () => {},
  activityGateway: () => {},
  eventGateway: (name, payload) => {
    if (name.startsWith("display:")) events.push({ name, payload });
  },
  dbGateway: {},
  pvGateway: { get: () => 0, evaluateCondition: () => false },
  runtimeGateway: {},
  eventStateGateway: { mark: () => {} },
  apiGateway: { call: () => null },
});

for (let step = 0; step < 20 && !events.some(({ name }) => name === "display:choice"); step += 1) {
  const text = events.filter(({ name }) => name === "display:text").at(-1);
  assert.ok(text?.payload.continueKey, "social dialogue did not expose a continue key");
  variables.set(text.payload.continueKey, true);
}
const choice = events.find(({ name }) => name === "display:choice");
assert.ok(choice, "social choice event was not emitted");
assert.equal(choice.payload.displayTo, "dorm-bottom");
assert.equal(choice.payload.options.length, 2);
assert.equal(choice.payload.selectionKey, "dlg:first_choice:select");
console.log("social-choice-runtime-probe: ok");
