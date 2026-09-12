import assert from "node:assert/strict";
import { ScheduleValueEvaluator } from "../js/core/ScheduleValueEvaluator.js";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { mainScheduleRuntime } = await import("../js/core/MainScheduleRuntime.js");
const { eventBus } = await import("../js/core/EventBus.js");
const { mainQueue } = await import("../js/core/ScheduleQueue.js");
const { ACTIVITY_EVENTS } = await import("../js/core/ScheduleEvents.js");
const { timeService } = await import("../js/core/TimeService.js");
const { medicalCaseManager } = await import("../js/core/MedicalCaseManager.js");
await import("../js/core/ScheduleTriggerRouter.js");

const blueprint = {
  nodes: {
    value: { id: "value", type: "getGlobal", inputs: { variableId: 1 }, valueOutputs: [{ name: "value" }] },
  },
  connections: [],
};
const globalValues = new Map([[1, 0]]);
const evaluator = new ScheduleValueEvaluator(blueprint, {
  globalVariableManager: { get: (id) => globalValues.get(id) },
  itemManager: { count: () => 0 },
});
assert.equal(evaluator.evaluateNode("value"), 0);
globalValues.set(1, 1);
evaluator.invalidate();
assert.equal(evaluator.evaluateNode("value"), 1);

await mainScheduleRuntime.init();
const before = mainQueue.getAll().length;
eventBus.emit(ACTIVITY_EVENTS.requested, {
  source: "item", itemId: "probe", action: "use", scheduleId: "probe:use",
  blueprint: null, context: { timeMinutes: 0 },
});
const probeEntry = mainQueue.getAll().find((entry) => entry.scheduleId === "probe:use");
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

console.log("schedule decoupling probe: ok");
