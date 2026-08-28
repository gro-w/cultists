import { eventBus } from "./EventBus.js";
import { createScheduleRunner } from "./ScheduleRunner.js";

let sequence = 0;

function definitionFor(payload) {
  const scheduleId = payload.blueprint?.id || `item:${payload.itemId}:${payload.action}`;
  return {
    ...payload.blueprint,
    id: scheduleId,
    blueprint: payload.blueprint,
    itemId: payload.itemId,
    action: payload.action,
  };
}

/** Execute item-owned schedules immediately after ItemManager emits them. */
export function runItemSchedule(payload = {}) {
  if (!payload.blueprint) return { ok: false, reason: "missingBlueprint" };
  const instanceId = `${definitionFor(payload).id}:${++sequence}`;
  const instance = { instanceId, scheduleId: definitionFor(payload).id, status: "pending", transcript: [] };
  const runner = createScheduleRunner({
    definition: definitionFor(payload),
    instance,
    appId: "item",
    appendLine: () => {},
    onComplete: () => {},
  });
  return runner.start();
}

export const itemScheduleRuntime = {
  subscribe() {
    return eventBus.on("schedule:triggered", runItemSchedule);
  },
};

itemScheduleRuntime.subscribe();
