import { createActivityRunner } from "./ActivityRunner.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";

/**
 * ActivityExecutionService - owns ActivityRunner lifetimes. Guarantees a
 * terminal event (`completed`/`cancelled`/`failed`) is emitted at most once
 * per instanceId, even if `complete()`/`cancel()` is called again or the
 * runner naturally finishes after being externally cancelled.
 */
export class ActivityExecutionService {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.runners = new Map();
    this._firedTerminal = new Set();
  }

  run({ queue, definition, instance, variableStore, timeGateway, windowGateway } = {}) {
    if (!queue || !definition || !instance) return null;
    if (instance.status === "resolved" || this.runners.has(instance.instanceId)) return null;

    const runner = createActivityRunner({
      definition,
      instance,
      variableStore,
      eventBus: this.eventBus,
      timeGateway,
      windowGateway,
      onCheckpoint: (updated) => {
        queue.update(updated.instanceId, updated);
        this.eventBus.emit(ACTIVITY_EVENTS.changed, { queueId: queue.queueId, instance: { ...updated } });
      },
      onComplete: (updated, reason) => {
        queue.update(updated.instanceId, updated);
        this.runners.delete(updated.instanceId);
        this._emitTerminalOnce(queue.queueId, updated, reason);
      },
    });

    this.runners.set(instance.instanceId, runner);
    runner.start();
    return runner;
  }

  _emitTerminalOnce(queueId, instance, reason) {
    if (this._firedTerminal.has(instance.instanceId)) return;
    this._firedTerminal.add(instance.instanceId);
    const eventName = reason === "cancelled"
      ? ACTIVITY_EVENTS.cancelled
      : reason === "failed"
        ? ACTIVITY_EVENTS.failed
        : ACTIVITY_EVENTS.completed;
    this.eventBus.emit(eventName, { queueId, instance: { ...instance } });
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
    return this.get(instanceId)?.cancel() || false;
  }

  /** Restore-safe teardown: cancels every live runner without re-emitting terminal events for already-resolved instances. */
  clear() {
    this.runners.forEach((runner) => runner.cancel());
    this.runners.clear();
  }
}

export default ActivityExecutionService;
