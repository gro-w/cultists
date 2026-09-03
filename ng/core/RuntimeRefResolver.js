export class RuntimeRefResolver {
  constructor({ activities, queues, windows } = {}) { this.activities = activities; this.queues = queues; this.windows = windows; }
  resolve(ref) { if (!ref || typeof ref !== "object") return { status: "unresolved", ref }; const owner = { activity: this.activities, queue: this.queues, window: this.windows }[ref.objectType]; const value = owner?.get?.(ref.objectId); return value ? { status: "resolved", value } : { status: "unresolved", ref }; }
  encode(objectType, objectId) { return { objectType, objectId }; }
}
