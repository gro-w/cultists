import { scheduleData } from "./ScheduleData.js";

/** Apply shared data-driven operations that schedule timers or other systems may expose. */
export function applyScheduleOperations(effects = {}) {
  const operations = [
    ...(Array.isArray(effects.operations) ? effects.operations : []),
    ...(effects.addSchedule ? (Array.isArray(effects.addSchedule) ? effects.addSchedule : [effects.addSchedule]) : []),
  ];
  return operations.map((operation) => {
    if (operation?.type !== "addSchedule" && !operation?.scheduleId) return { ok: false, reason: "unknownOperation" };
    const addTime = operation?.addTime ?? (Number.isInteger(Number(operation?.day)) && Number.isInteger(Number(operation?.time))
      ? Number(operation.day) * 1440 + Number(operation.time) : undefined);
    return scheduleData.addSchedule(operation.scheduleId, addTime, operation.queueId || operation.queue, {
      respectPrerequisite: operation.respectPrerequisite,
      protectFromExpiry: operation.protectFromExpiry,
    });
  });
}

export default applyScheduleOperations;
