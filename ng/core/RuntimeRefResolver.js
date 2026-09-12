export class RuntimeRefResolver {
  constructor({ schedules, queues, windows } = {}) { this.schedules = schedules; this.queues = queues; this.windows = windows; }
  resolve(ref) { if (!ref || typeof ref !== "object") return { status: "unresolved", ref }; const owner = { schedule: this.schedules, queue: this.queues, window: this.windows }[ref.objectType]; const value = owner?.get?.(ref.objectId); return value ? { status: "resolved", value } : { status: "unresolved", ref }; }
  encode(objectType, objectId) { return { objectType, objectId }; }
}
