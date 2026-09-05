import { ActivityQueue } from "./ActivityQueue.js";

/**
 * ActivityQueueRegistry - owns every ActivityQueue instance, keyed by
 * queueId. Always registers the built-in non-blocking "main" queue (plan
 * §16 decision 2: `default/default` auto-enqueues into `main`).
 */
export class ActivityQueueRegistry {
  constructor() {
    this.queues = new Map();
    this.register("main", { nonBlocking: true });
  }

  register(queueId, options = {}) {
    const queue = new ActivityQueue(queueId, options);
    this.queues.set(queueId, queue);
    return queue;
  }

  get(queueId) {
    return this.queues.get(queueId) || null;
  }

  list() {
    return [...this.queues.values()];
  }

  snapshot() {
    const result = {};
    for (const [queueId, queue] of this.queues.entries()) result[queueId] = queue.snapshot();
    return result;
  }

  restore(data = {}) {
    for (const [queueId, entries] of Object.entries(data)) {
      const queue = this.get(queueId) || this.register(queueId);
      queue.restore(entries);
    }
  }
}

export default ActivityQueueRegistry;
