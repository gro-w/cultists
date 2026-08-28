import { eventBus } from "./EventBus.js";

class ScheduleQueue {
  constructor(queueId) {
    this.queueId = queueId;
    this.entries = [];
  }

  append(entries = []) {
    const added = entries.map((entry) => ({
      ...entry,
      payload: entry.payload || entry,
      instanceId: `${this.queueId}:${entry.id || entry.npcId || this.entries.length}:${this.entries.length}`,
      status: "pending",
    }));
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

  hasCompletedId(scheduleId) {
    return this.entries.some((entry) =>
      entry.status === "completed" && (entry.payload?.id === scheduleId || entry.id === scheduleId)
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
    this.entries = (Array.isArray(entries) ? entries : []).map((entry) => ({
      ...entry,
      status: entry.status === "completed" ? "completed" : "pending",
    }));
    eventBus.emit("schedule:changed", { queueId: this.queueId });
  }

  snapshot() {
    return this.getAll();
  }
}

export const workQueue = new ScheduleQueue("work");
export const socialQueue = new ScheduleQueue("social");
export default ScheduleQueue;
