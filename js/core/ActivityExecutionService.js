import { createActivityRunner } from "./ActivityRunner.js";

/**
 * Owns ActivityRunner lifetimes. UI surfaces provide a queue, definition and
 * presentation callbacks; this service owns creation, completion and teardown.
 */
class ActivityExecutionService {
  constructor() {
    this.runners = new Map();
    this.restoring = false;
  }

  run({ queue, definition, instance, onCheckpoint = () => {}, onComplete = () => {}, ...options } = {}) {
    if (this.restoring || !queue || !instance?.instanceId) return null;
    if (this.runners.has(instance.instanceId) || instance.status === "resolved") return null;
    const finish = () => {
      this.runners.delete(instance.instanceId);
      onComplete(instance);
    };
    const runner = createActivityRunner({
      ...options,
      queueId: queue.queueId,
      definition,
      instance,
      onCheckpoint: (next) => {
        queue.updateInstance(instance.instanceId, next);
        onCheckpoint(next);
      },
      onComplete: finish,
    });
    this.runners.set(instance.instanceId, runner);
    try {
      runner.start();
      if (instance.status === "resolved") this.runners.delete(instance.instanceId);
      return runner;
    } catch (error) {
      this.runners.delete(instance.instanceId);
      throw error;
    }
  }

  complete(queue, instanceId) {
    return queue?.complete(instanceId) || false;
  }

  beginRestore() {
    this.restoring = true;
    this.runners.forEach((runner) => runner.cancel());
    this.runners.clear();
  }

  endRestore() {
    this.restoring = false;
  }

  clear() {
    this.runners.forEach((runner) => runner.cancel());
    this.runners.clear();
  }
}

export const activityExecutionService = new ActivityExecutionService();
export default ActivityExecutionService;
