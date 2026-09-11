import { activityData } from "./ActivityData.js";

/** Apply shared data-driven operations that activity timers or other systems may expose. */
export function applyActivityOperations(effects = {}) {
  const operations = [
    ...(Array.isArray(effects.operations) ? effects.operations : []),
    ...(effects.addActivity ? (Array.isArray(effects.addActivity) ? effects.addActivity : [effects.addActivity]) : []),
  ];
  return operations.map((operation) => {
    if (operation?.type !== "addActivity" && !operation?.activityId) return { ok: false, reason: "unknownOperation" };
    const addTime = operation?.addTime ?? (Number.isInteger(Number(operation?.day)) && Number.isInteger(Number(operation?.time))
      ? Number(operation.day) * 1440 + Number(operation.time) : undefined);
    return activityData.addActivity(operation.activityId, addTime, operation.queueId || operation.queue, {
      respectPrerequisite: operation.respectPrerequisite,
      protectFromExpiry: operation.protectFromExpiry,
    });
  });
}

export default applyActivityOperations;
