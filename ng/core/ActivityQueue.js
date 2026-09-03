import { createActivityInstance, cloneActivityInstance } from "./ActivityInstance.js";

/**
 * ActivityQueue - an ordered collection of Activity instances for one
 * queue (e.g. "main"). Owns instanceId assignment (per-activity sequence
 * numbers) and instance mutation; ActivityRunner/ActivityExecutionService
 * never touch `entries` directly, only through this API.
 */
export class ActivityQueue {
  constructor(queueId, options = {}) {
    this.queueId = queueId;
    this.nonBlocking = Boolean(options.nonBlocking);
    this.entries = [];
    this._sequence = new Map();
  }

  /** Append a new instance for `activityId` and return the created instance. */
  append({ activityId, instanceId, currentNodeId } = {}) {
    if (!activityId) throw new Error("ActivityQueue.append requires an activityId");
    const sequence = (this._sequence.get(activityId) || 0) + 1;
    this._sequence.set(activityId, sequence);
    const instance = createActivityInstance({
      instanceId: instanceId || `${activityId}:${sequence}`,
      activityId,
      queueId: this.queueId,
      currentNodeId,
    });
    this.entries.push(instance);
    return instance;
  }

  get(instanceId) {
    return this.entries.find((entry) => entry.instanceId === instanceId) || null;
  }

  update(instanceId, patch = {}) {
    const entry = this.get(instanceId);
    if (!entry) return false;
    Object.assign(entry, patch);
    return true;
  }

  /** Idempotent: completing an already-resolved instance is a no-op, not an error. */
  complete(instanceId) {
    const entry = this.get(instanceId);
    if (!entry || entry.status === "resolved") return false;
    entry.status = "resolved";
    entry.resolutionReason = entry.resolutionReason || "completed";
    return true;
  }

  cancel(instanceId) {
    const entry = this.get(instanceId);
    if (!entry || entry.status === "resolved") return false;
    entry.status = "resolved";
    entry.resolutionReason = "cancelled";
    return true;
  }

  /** The single active (unresolved) instance — queues are processed one at a time. */
  current() {
    return this.entries.find((entry) => entry.status === "unresolved") || null;
  }

  countByActivity(activityId) {
    return this.entries.filter((entry) => entry.activityId === activityId).length;
  }

  /** Deep-cloned entries, breaking every live reference (true save boundary). */
  snapshot() {
    return this.entries.map((entry) => cloneActivityInstance(entry));
  }

  restore(entries = []) {
    if (!Array.isArray(entries)) throw new Error("Invalid activity queue snapshot");
    const seen = new Set();
    this.entries = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.activityId !== "string" || !entry.activityId) {
        throw new Error("Invalid activity instance");
      }
      if (typeof entry.instanceId !== "string" || !entry.instanceId || seen.has(entry.instanceId)) {
        throw new Error("Invalid or duplicate activity instance ID");
      }
      seen.add(entry.instanceId);
      return cloneActivityInstance(entry);
    });
    this._sequence = new Map();
    this.entries.forEach((entry) => {
      const match = String(entry.instanceId).match(/:(\d+)$/);
      if (!match) return;
      const next = Number(match[1]);
      this._sequence.set(entry.activityId, Math.max(this._sequence.get(entry.activityId) || 0, next));
    });
  }
}

export default ActivityQueue;
