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

  executeImmediate({ queue, instance, execute, onComplete = () => {} } = {}) {
    if (this.restoring || !queue || !instance?.instanceId || typeof execute !== "function") return null;
    if (queue.statusOf(instance.instanceId) === "nonexistent") [instance] = queue.append([instance]);
    else instance = queue.getInstance(instance.instanceId) || instance;
    if (instance.status === "resolved") return instance;
    const result = execute(instance);
    queue.complete(instance.instanceId);
    const resolved = queue.getInstance(instance.instanceId) || { ...instance, status: "resolved" };
    onComplete(resolved, result);
    return resolved;
  }

  get(instanceId) {
    return this.runners.get(instanceId) || null;
  }

  pause(instanceId) {
    return this.get(instanceId)?.pause() || false;
  }

  resume(instanceId) {
    return this.get(instanceId)?.resume() || false;
  }

  cancel(instanceId) {
    const runner = this.runners.get(instanceId);
    if (!runner) return false;
    runner.cancel();
    this.runners.delete(instanceId);
    return true;
  }

  checkpoint(queue, instanceId, patch = {}) {
    return queue?.updateInstance(instanceId, patch) || false;
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
