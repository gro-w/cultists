import assert from "node:assert/strict";
import { ActivityValueEvaluator } from "../js/core/ActivityValueEvaluator.js";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { mainActivityRuntime } = await import("../js/core/MainActivityRuntime.js");
const { eventBus } = await import("../js/core/EventBus.js");
const { mainQueue } = await import("../js/core/ActivityQueue.js");
const { ACTIVITY_EVENTS } = await import("../js/core/ActivityEvents.js");
const { timeService } = await import("../js/core/TimeService.js");
const { medicalCaseManager } = await import("../js/core/MedicalCaseManager.js");
await import("../js/core/ActivityTriggerRouter.js");

const blueprint = {
  nodes: {
    value: { id: "value", type: "getGlobal", inputs: { variableId: 1 }, valueOutputs: [{ name: "value" }] },
  },
  connections: [],
};
const globalValues = new Map([[1, 0]]);
const evaluator = new ActivityValueEvaluator(blueprint, {
  globalVariableManager: { get: (id) => globalValues.get(id) },
  itemManager: { count: () => 0 },
});
assert.equal(evaluator.evaluateNode("value"), 0);
globalValues.set(1, 1);
evaluator.invalidate();
assert.equal(evaluator.evaluateNode("value"), 1);

await mainActivityRuntime.init();
const before = mainQueue.getAll().length;
eventBus.emit(ACTIVITY_EVENTS.requested, {
  source: "item", itemId: "probe", action: "use", activityId: "probe:use",
  blueprint: null, context: { timeMinutes: 0 },
});
const probeEntry = mainQueue.getAll().find((entry) => entry.activityId === "probe:use");
assert.ok(probeEntry);
assert.equal(probeEntry.status, "resolved");
assert.equal(mainQueue.getAll().length, before + 1);

const originalSettleDay = medicalCaseManager.settleDay;
const medicalResult = [{ patientId: "probe" }];
medicalCaseManager.settleDay = () => medicalResult;
try {
  assert.equal(timeService.settleAtEight({ day: 1 }).medical, medicalResult);
} finally {
  medicalCaseManager.settleDay = originalSettleDay;
}

console.log("activity decoupling probe: ok");
