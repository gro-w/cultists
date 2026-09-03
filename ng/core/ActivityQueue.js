import { ActivityInstance } from "./ActivityInstance.js";
export class ActivityQueue {
  constructor({ queueId, displayName = queueId, mode = "serial", autoStart = true, maxConcurrency = 1 } = {}) { if (!queueId) throw new Error("queueId is required"); this.queueId = queueId; this.displayName = displayName; this.mode = mode; this.autoStart = autoStart; this.maxConcurrency = maxConcurrency; this.entries = []; this.activeInstanceIds = []; }
  append(instance) { if (instance.queueId !== this.queueId) throw new Error(`Queue mismatch: ${instance.queueId}`); const existing = this.entries.find((entry) => entry.instanceId === instance.instanceId); if (existing) return existing; this.entries.push(instance); return instance; }
  getInstance(id) { return this.entries.find((entry) => entry.instanceId === id); }
  pending() { return this.entries.filter((entry) => !entry.terminalEmitted); }
  complete(id, result = null) { const entry = this.getInstance(id); if (!entry) throw new Error(`Unknown activity instance: ${id}`); entry.transition("resolved", result); this.activeInstanceIds = this.activeInstanceIds.filter((value) => value !== id); return entry; }
  snapshot() { return { queueId: this.queueId, displayName: this.displayName, mode: this.mode, autoStart: this.autoStart, maxConcurrency: this.maxConcurrency, entries: this.entries.map((entry) => entry.snapshot()), activeInstanceIds: [...this.activeInstanceIds] }; }
  restore(snapshot) { this.entries = (snapshot.entries || []).map((entry) => ActivityInstance.restore(entry)); this.activeInstanceIds = [...(snapshot.activeInstanceIds || [])]; }
}
