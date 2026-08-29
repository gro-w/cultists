import { eventBus } from "./EventBus.js";
import { workQueue } from "./ScheduleQueue.js";
import { createScheduleRunner } from "./ScheduleRunner.js";

/** Executes non-interactive medical incidents appended to the public work queue. */
class MedicalScheduleRuntime {
  constructor() {
    this._initialized = false;
    this._running = new Set();
    this._scanQueued = false;
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    eventBus.on("schedule:appended", ({ queueId, entries = [] }) => {
      if (queueId !== "work") return;
      entries.filter((entry) => entry.kind === "medicalIncident").forEach((entry) => this.run(entry));
    });
    eventBus.on("schedule:changed", ({ queueId }) => {
      if (queueId === "work") this._queuePendingScan();
    });
    this._runPending();
  }

  _queuePendingScan() {
    if (this._scanQueued) return;
    this._scanQueued = true;
    queueMicrotask(() => {
      this._scanQueued = false;
      this._runPending();
    });
  }

  _runPending() {
    workQueue.getPending()
      .filter((entry) => entry.kind === "medicalIncident")
      .forEach((entry) => this.run(entry));
  }

  run(entry) {
    if (!entry?.instanceId || this._running.has(entry.instanceId) || entry.status === "resolved") return;
    this._running.add(entry.instanceId);
    try {
      createScheduleRunner({
        definition: entry,
        instance: entry,
        appId: "medical",
        onCheckpoint: (instance) => workQueue.updateInstance(instance.instanceId, instance),
        onComplete: (instance) => workQueue.complete(instance.instanceId),
      }).start();
    } finally {
      this._running.delete(entry.instanceId);
    }
  }
}

export const medicalScheduleRuntime = new MedicalScheduleRuntime();
export default MedicalScheduleRuntime;
