import { workQueue, socialQueue, mainQueue } from "./ActivityQueue.js";

class ActivityQueueRegistry {
  constructor() {
    this._queues = new Map();
  }

  register(queue) {
    if (!queue?.queueId) throw new Error("Activity queue requires a stable queueId");
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

export const activityQueueRegistry = new ActivityQueueRegistry();
[workQueue, socialQueue, mainQueue].forEach((queue) => activityQueueRegistry.register(queue));
export default ActivityQueueRegistry;
