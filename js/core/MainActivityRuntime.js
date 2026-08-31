import { eventBus } from "./EventBus.js";
import { mainQueue } from "./ActivityQueue.js";
import { activityExecutionService } from "./ActivityExecutionService.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";

/** Execute only main entries explicitly owned by the main activityRunner. */
class MainActivityRuntime {
  constructor() {
    this._initPromise = null;
    this._unsubscribe = null;
    this._running = new Set();

    this._ready = false;
    this._restoring = false;
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = Promise.resolve().then(() => {
        this._unsubscribe = eventBus.on(ACTIVITY_EVENTS.appended, (payload) => {
          if (payload?.queueId !== "main") return;
          (payload.entries || []).filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
        });
        this._startPending();
      });
    }
    return this._initPromise;
  }

  run(entry) {
    if (!this._ready || this._restoring) return;
    if (!entry?.instanceId || this._running.has(entry.instanceId) || entry.status === "resolved") return;
    this._running.add(entry.instanceId);
    try {
      const runner = activityExecutionService.run({
        queue: mainQueue,
        definition: entry.payload || entry,
        instance: entry,
        appId: "main",
        onComplete: () => { mainQueue.complete(entry.instanceId); this._running.delete(entry.instanceId); },
      });
      if (!runner) this._running.delete(entry.instanceId);
      if (entry.status === "resolved") this._running.delete(entry.instanceId);
    } catch (error) {
      this._running.delete(entry.instanceId);
      console.error(`[MainActivityRuntime] Failed to execute ${entry.activityId}:`, error);
    }
  }

  _startPending() {
    if (!this._ready || this._restoring) return;
    mainQueue.getPending().filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
  }

  activate() {
    this._ready = true;
    this._startPending();
  }

  beginRestore() {
    this._restoring = true;
    activityExecutionService.beginRestore();
    this._running.clear();
  }

  endRestore() {
    this._restoring = false;
    activityExecutionService.endRestore();
  }
}

export const mainActivityRuntime = new MainActivityRuntime();
export default MainActivityRuntime;
