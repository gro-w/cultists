import { eventBus } from "./EventBus.js";
import { mainQueue } from "./ActivityQueue.js";
import { createActivityRunner } from "./ActivityRunner.js";

/** Execute only main entries explicitly owned by the main activityRunner. */
class MainActivityRuntime {
  constructor() {
    this._initPromise = null;
    this._unsubscribe = null;
    this._running = new Set();
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = Promise.resolve().then(() => {
        this._unsubscribe = eventBus.on("activity:appended", (payload) => {
          if (payload?.queueId !== "main") return;
          (payload.entries || []).filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
        });
        mainQueue.getPending().filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
      });
    }
    return this._initPromise;
  }

  run(entry) {
    if (!entry?.instanceId || this._running.has(entry.instanceId) || entry.status === "resolved") return;
    this._running.add(entry.instanceId);
    const finish = () => this._running.delete(entry.instanceId);
    try {
      const runner = createActivityRunner({
        definition: entry.payload || entry,
        instance: entry,
        appId: "main",
        onCheckpoint: (next) => mainQueue.updateInstance(entry.instanceId, next),
        onComplete: () => { mainQueue.complete(entry.instanceId); finish(); },
      });
      runner.start();
      if (entry.status === "resolved") finish();
    } catch (error) {
      finish();
      console.error(`[MainActivityRuntime] Failed to execute ${entry.activityId}:`, error);
    }
  }
}

export const mainActivityRuntime = new MainActivityRuntime();
export default MainActivityRuntime;
