import { eventBus } from "./EventBus.js";
import { realtimeQueue } from "./ScheduleQueue.js";
import { createScheduleRunner } from "./ScheduleRunner.js";

/** Execute only realtime entries explicitly owned by the realtime scheduler. */
class RealtimeScheduleRuntime {
  constructor() {
    this._initPromise = null;
    this._unsubscribe = null;
    this._running = new Set();
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = Promise.resolve().then(() => {
        this._unsubscribe = eventBus.on("schedule:appended", (payload) => {
          if (payload?.queueId !== "realtime") return;
          (payload.entries || []).filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
        });
        realtimeQueue.getPending().filter((entry) => entry.autoRun).forEach((entry) => this.run(entry));
      });
    }
    return this._initPromise;
  }

  run(entry) {
    if (!entry?.instanceId || this._running.has(entry.instanceId) || entry.status === "resolved") return;
    this._running.add(entry.instanceId);
    const finish = () => this._running.delete(entry.instanceId);
    try {
      const runner = createScheduleRunner({
        definition: entry.payload || entry,
        instance: entry,
        appId: "realtime",
        onCheckpoint: (next) => realtimeQueue.updateInstance(entry.instanceId, next),
        onComplete: () => { realtimeQueue.complete(entry.instanceId); finish(); },
      });
      runner.start();
      if (entry.status === "resolved") finish();
    } catch (error) {
      finish();
      console.error(`[RealtimeScheduleRuntime] Failed to execute ${entry.scheduleId}:`, error);
    }
  }
}

export const realtimeScheduleRuntime = new RealtimeScheduleRuntime();
export default RealtimeScheduleRuntime;
