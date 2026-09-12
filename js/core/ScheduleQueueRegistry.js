import { workQueue, socialQueue, mainQueue } from "./ScheduleQueue.js";

class ScheduleQueueRegistry {
  constructor() {
    this._queues = new Map();
  }

  register(queue) {
    if (!queue?.queueId) throw new Error("Schedule queue requires a stable queueId");
    this._queues.set(queue.queueId, queue);
    return queue;
  }

  get(queueId, fallback = "main") {
    return this._queues.get(queueId) || this._queues.get(fallback) || null;
  }

  has(queueId) { return this._queues.has(queueId); }
  ids() { return [...this._queues.keys()]; }
  all() { return [...this._queues.values()]; }
  list() { return this.all(); }
}

export const scheduleQueueRegistry = new ScheduleQueueRegistry();
[workQueue, socialQueue, mainQueue].forEach((queue) => scheduleQueueRegistry.register(queue));
export default ScheduleQueueRegistry;
