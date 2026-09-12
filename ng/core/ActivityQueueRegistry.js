import { ScheduleQueue } from "./ScheduleQueue.js";
export class ScheduleQueueRegistry {
  constructor(eventBus) { this.eventBus = eventBus; this.queues = new Map(); }
  register(definition) { const queue = definition instanceof ScheduleQueue ? definition : new ScheduleQueue(definition); if (this.queues.has(queue.queueId)) throw new Error(`Duplicate queue: ${queue.queueId}`); this.queues.set(queue.queueId, queue); return queue; }
  get(queueId) { const queue = this.queues.get(queueId); if (!queue) throw new Error(`Unknown queue: ${queueId}`); return queue; }
  append(instance) { const entry = this.get(instance.queueId).append(instance); this.eventBus?.emit("schedule:queued", { instanceId: entry.instanceId, queueId: entry.queueId }); this.eventBus?.emit("queue:changed", { queueId: entry.queueId }); return entry; }
  snapshot() { return Object.fromEntries([...this.queues].map(([id, queue]) => [id, queue.snapshot()])); }
  restore(snapshot = {}) { for (const [id, value] of Object.entries(snapshot)) { const queue = this.queues.get(id) || this.register(value); queue.restore(value); } }
}
