export const ACTIVITY_EVENTS = Object.freeze({
  appended: "activity:appended",
  changed: "activity:changed",
  resolved: "activity:resolved",
  completed: "activity:completed",
  triggered: "activity:triggered",
  requested: "activity:requested",
  image: "activity:image",
  cg: "activity:cg",
  endCg: "activity:end_cg",
});

export function activityEventPayload(queueId, instance, extra = {}) {
  return { queueId: queueId || null, instanceId: instance?.instanceId || null, instance: instance || null, ...extra };
}
