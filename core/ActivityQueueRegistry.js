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

  /** Generic queue API exposed to blueprints and developer tools. */
  append(queueId, options) {
    const queue = this.get(queueId) || this.register(queueId);
    return queue.append(options);
  }

  listEntries(queueId, filters) {
    return this.get(queueId)?.list(filters) || [];
  }

  listQueues() {
    return this.list().map((queue) => ({ queueId: queue.queueId, nonBlocking: queue.nonBlocking }));
  }

  getEntry(queueId, instanceId) {
    return this.get(queueId)?.get(instanceId) || null;
  }

  updateEntry(queueId, instanceId, patch) {
    return this.get(queueId)?.update(instanceId, patch) || false;
  }

  completeEntry(queueId, instanceId) {
    return this.get(queueId)?.complete(instanceId) || false;
  }

  cancelEntry(queueId, instanceId) {
    return this.get(queueId)?.cancel(instanceId) || false;
  }

  removeEntry(queueId, instanceId) {
    return this.get(queueId)?.remove(instanceId) || false;
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
