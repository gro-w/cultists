import { eventBus } from "./EventBus.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

const globalSequenceByActivity = new Map();
const VALID_STATUSES = new Set(["unresolved", "resolved"]);

class ActivityQueue {
  constructor(queueId, options = {}) {
    this.queueId = queueId;
    this.singleCurrent = Boolean(options.singleCurrent);
    this.nonBlocking = Boolean(options.nonBlocking);
    this.entries = [];
    this.sequenceByActivity = new Map();
  }

  append(entries = []) {
    const batch = Array.isArray(entries) ? entries : [entries];
    const added = batch.map((entry) => {
      const activityId = entry.activityId || entry.payload?.activityId || entry.id || entry.payload?.id;
      const sequence = Math.max(this.sequenceByActivity.get(activityId) || 0, globalSequenceByActivity.get(activityId) || 0);
      this.sequenceByActivity.set(activityId, sequence + 1);
      globalSequenceByActivity.set(activityId, sequence + 1);
      return {
        ...entry,
        activityId,
        payload: entry.payload || entry,
        instanceId: entry.instanceId || `${activityId}:${sequence + 1}`,
        status: entry.status === "resolved" || entry.status === "completed" ? "resolved" : "unresolved",
        currentNodeId: entry.currentNodeId || entry.payload?.currentNodeId || entry.payload?.blueprint?.startNodeId || entry.payload?.startNodeId || null,
        executedNodeIds: Array.isArray(entry.executedNodeIds) ? [...entry.executedNodeIds] : [],
        transcript: Array.isArray(entry.transcript) ? [...entry.transcript] : [],
      };
    });
    this.entries.push(...added);
    if (added.length) eventBus.emit("activity:appended", { queueId: this.queueId, entries: added });
    return added;
  }

  complete(instanceId) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    if (!entry) return false;
    entry.status = "resolved";
    if (this.queueId === "social") {
      const variableId = { ajie: 100, awei: 101 }[entry.payload?.npcId || entry.npcId];
      if (variableId !== undefined && globalVariableManager.definition(variableId)) globalVariableManager.set(variableId, true);
    }
    eventBus.emit("activity:changed", { queueId: this.queueId, entry });
    return true;
  }

  expire(instanceId) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    if (!entry || entry.status !== "unresolved") return false;
    entry.status = "resolved";
    entry.resolutionReason = "expired";
    eventBus.emit("activity:changed", { queueId: this.queueId, entry, expired: true });
    return true;
  }

  updateInstance(instanceId, patch = {}) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    if (!entry) return false;
    Object.assign(entry, patch);
    eventBus.emit("activity:changed", { queueId: this.queueId, entry });
    return true;
  }

  getInstance(instanceId) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    return entry ? { ...entry, transcript: [...(entry.transcript || [])] } : null;
  }

  countByActivity(activityId) {
    return this.entries.filter((entry) => entry.activityId === activityId).length;
  }

  statusOf(instanceId) {
    return this.entries.find((item) => item.instanceId === instanceId)?.status || "nonexistent";
  }

  hasCompletedId(activityId) {
    return this.entries.some((entry) =>
      entry.status === "resolved" && entry.activityId === activityId
    );
  }

  getAll() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  getPending() {
    return this.entries.filter((entry) => entry.status === "unresolved");
  }

  getPendingForBatch(day, time) {
    return this.entries.filter((entry) =>
      entry.status === "unresolved" && entry.receivedDay === day && entry.receivedTime === time
    );
  }

  hasPendingBatch(day, time) {
    return this.getPendingForBatch(day, time).length > 0;
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
      if (!VALID_STATUSES.has(entry.status)) throw new Error("Invalid activity instance status");
      if (!Array.isArray(entry.transcript)) throw new Error("Invalid activity transcript");
      seen.add(entry.instanceId);
      return { ...entry, queueId: this.queueId, executedNodeIds: Array.isArray(entry.executedNodeIds) ? [...entry.executedNodeIds] : [], transcript: [...entry.transcript] };
    });
    this.sequenceByActivity = new Map();
    this.entries.forEach((entry) => {
      const activityId = entry.activityId || entry.payload?.activityId || entry.id || entry.payload?.id;
      const match = String(entry.instanceId || "").match(/:(\d+)$/);
      const next = match ? Number(match[1]) : 0;
      this.sequenceByActivity.set(activityId, Math.max(this.sequenceByActivity.get(activityId) || 0, next));
      globalSequenceByActivity.set(activityId, Math.max(globalSequenceByActivity.get(activityId) || 0, next));
    });
    eventBus.emit("activity:changed", { queueId: this.queueId });
  }

  snapshot() {
    return this.getAll().map((entry) => ({ ...entry, transcript: [...(entry.transcript || [])] }));
  }

  /** The first unresolved item is the only active item in serialized queues. */
  current() {
    return this.singleCurrent
      ? this.entries.find((entry) => entry.status === "unresolved") || null
      : this.entries.find((entry) => entry.status === "unresolved") || null;
  }
}

export const workQueue = new ActivityQueue("work");
export const socialQueue = new ActivityQueue("social");
export const mainQueue = new ActivityQueue("main", { nonBlocking: true });
export default ActivityQueue;
