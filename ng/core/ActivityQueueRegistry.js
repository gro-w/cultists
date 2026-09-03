import { ActivityQueue } from "./ActivityQueue.js";
export class ActivityQueueRegistry {
  constructor(eventBus) { this.eventBus = eventBus; this.queues = new Map(); }
  register(definition) { const queue = definition instanceof ActivityQueue ? definition : new ActivityQueue(definition); if (this.queues.has(queue.queueId)) throw new Error(`Duplicate queue: ${queue.queueId}`); this.queues.set(queue.queueId, queue); return queue; }
  get(queueId) { const queue = this.queues.get(queueId); if (!queue) throw new Error(`Unknown queue: ${queueId}`); return queue; }
  append(instance) { const entry = this.get(instance.queueId).append(instance); this.eventBus?.emit("activity:queued", { instanceId: entry.instanceId, queueId: entry.queueId }); this.eventBus?.emit("queue:changed", { queueId: entry.queueId }); return entry; }
  snapshot() { return Object.fromEntries([...this.queues].map(([id, queue]) => [id, queue.snapshot()])); }
  restore(snapshot = {}) { for (const [id, value] of Object.entries(snapshot)) { const queue = this.queues.get(id) || this.register(value); queue.restore(value); } }
}
