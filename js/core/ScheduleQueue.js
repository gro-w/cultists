import { eventBus } from "./EventBus.js";

const globalSequenceBySchedule = new Map();
const VALID_STATUSES = new Set(["pending", "completed"]);

class ScheduleQueue {
  constructor(queueId) {
    this.queueId = queueId;
    this.entries = [];
    this.sequenceBySchedule = new Map();
  }

  append(entries = []) {
    const added = entries.map((entry) => {
      const scheduleId = entry.scheduleId || entry.payload?.scheduleId || entry.id || entry.payload?.id;
      const sequence = Math.max(this.sequenceBySchedule.get(scheduleId) || 0, globalSequenceBySchedule.get(scheduleId) || 0);
      this.sequenceBySchedule.set(scheduleId, sequence + 1);
      globalSequenceBySchedule.set(scheduleId, sequence + 1);
      return {
        ...entry,
        scheduleId,
        payload: entry.payload || entry,
        instanceId: entry.instanceId || `${scheduleId}:${sequence + 1}`,
        status: entry.status === "completed" ? "completed" : "pending",
        transcript: Array.isArray(entry.transcript) ? [...entry.transcript] : [],
      };
    });
    this.entries.push(...added);
    if (added.length) eventBus.emit("schedule:appended", { queueId: this.queueId, entries: added });
    return added;
  }

  complete(instanceId) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    if (!entry) return false;
    entry.status = "completed";
    eventBus.emit("schedule:changed", { queueId: this.queueId, entry });
    return true;
  }

  updateInstance(instanceId, patch = {}) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    if (!entry) return false;
    Object.assign(entry, patch);
    eventBus.emit("schedule:changed", { queueId: this.queueId, entry });
    return true;
  }

  getInstance(instanceId) {
    const entry = this.entries.find((item) => item.instanceId === instanceId);
    return entry ? { ...entry, transcript: [...(entry.transcript || [])] } : null;
  }

  countBySchedule(scheduleId) {
    return this.entries.filter((entry) => entry.scheduleId === scheduleId).length;
  }

  statusOf(instanceId) {
    return this.entries.find((item) => item.instanceId === instanceId)?.status || "nonexistent";
  }

  hasCompletedId(scheduleId) {
    return this.entries.some((entry) =>
      entry.status === "completed" && entry.scheduleId === scheduleId
    );
  }

  getAll() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  getPending() {
    return this.entries.filter((entry) => entry.status === "pending");
  }

  getPendingForBatch(day, time) {
    return this.entries.filter((entry) =>
      entry.status === "pending" && entry.receivedDay === day && entry.receivedTime === time
    );
  }

  hasPendingBatch(day, time) {
    return this.getPendingForBatch(day, time).length > 0;
  }

  restore(entries = []) {
    if (!Array.isArray(entries)) throw new Error("Invalid schedule queue snapshot");
    const seen = new Set();
    this.entries = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.scheduleId !== "string" || !entry.scheduleId) {
        throw new Error("Invalid schedule instance");
      }
      if (typeof entry.instanceId !== "string" || !entry.instanceId || seen.has(entry.instanceId)) {
        throw new Error("Invalid or duplicate schedule instance ID");
      }
      if (!VALID_STATUSES.has(entry.status)) throw new Error("Invalid schedule instance status");
      if (!Array.isArray(entry.transcript)) throw new Error("Invalid schedule transcript");
      seen.add(entry.instanceId);
      return { ...entry, queueId: this.queueId, transcript: [...entry.transcript] };
    });
    this.sequenceBySchedule = new Map();
    this.entries.forEach((entry) => {
      const scheduleId = entry.scheduleId || entry.payload?.scheduleId || entry.id || entry.payload?.id;
      const match = String(entry.instanceId || "").match(/:(\d+)$/);
      const next = match ? Number(match[1]) : 0;
      this.sequenceBySchedule.set(scheduleId, Math.max(this.sequenceBySchedule.get(scheduleId) || 0, next));
      globalSequenceBySchedule.set(scheduleId, Math.max(globalSequenceBySchedule.get(scheduleId) || 0, next));
    });
    eventBus.emit("schedule:changed", { queueId: this.queueId });
  }

  snapshot() {
    return this.getAll().map((entry) => ({ ...entry, transcript: [...(entry.transcript || [])] }));
  }
}

export const workQueue = new ScheduleQueue("work");
export const socialQueue = new ScheduleQueue("social");
export default ScheduleQueue;
