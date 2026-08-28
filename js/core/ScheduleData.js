import { dataLoader } from "./DataLoader.js";
import { specialEventManager } from "./SpecialEventManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { calendarData } from "./CalendarData.js";
import { gameState } from "./GameState.js";
import { workQueue, socialQueue } from "./ScheduleQueue.js";

const CHECKPOINTS = [
  { suffix: "a", time: 8 * 60 },
  { suffix: "b", time: 16 * 60 },
];

class ScheduleData {
  constructor() {
    this.totalDays = 30;
    this.slots = new Map();
    this.fired = new Set();
    this.lastAbsoluteMinute = null;
    this._initPromise = null;
  }

  async init() {
    if (!this._initPromise) this._initPromise = this._loadAll();
    return this._initPromise;
  }

  async _loadAll() {
    await calendarData.init();
    this.totalDays = calendarData.totalDays;
    const requests = [];
    for (let day = 1; day <= this.totalDays; day += 1) {
      for (const checkpoint of CHECKPOINTS) {
        for (const queueId of ["work", "social"]) {
          const file = `${queueId}${String(day).padStart(2, "0")}${checkpoint.suffix}.json`;
          requests.push(dataLoader.loadJSON(file).then((data) => {
            this.slots.set(`${day}:${checkpoint.time}:${queueId}`, Array.isArray(data.entries) ? data.entries : []);
          }));
        }
      }
    }
    await Promise.all(requests);
    await Promise.all([specialEventManager.load(), favorabilityManager.load(), npcStateManager.load()]);
    this.initializeAt(gameState.day, gameState.clockMinutes);
  }

  initializeAt(day, clockMinutes) {
    this.fired.clear();
    this.lastAbsoluteMinute = null;
    const target = Number(day) * 1440 + Number(clockMinutes);
    this._appendThrough(target);
    this.lastAbsoluteMinute = target;
  }

  restoreAt(day, clockMinutes) {
    this.fired.clear();
    const target = Number(day) * 1440 + Number(clockMinutes);
    for (let absolute = 0; absolute <= target; absolute += 1) {
      const dayNumber = Math.floor(absolute / 1440);
      const minute = absolute % 1440;
      if (minute === 8 * 60 || minute === 16 * 60) {
        for (const queueId of ["work", "social"]) this.fired.add(`${dayNumber}:${minute}:${queueId}`);
      }
    }
    this.lastAbsoluteMinute = target;
  }

  advanceTo(day, clockMinutes) {
    const target = Number(day) * 1440 + Number(clockMinutes);
    if (this.lastAbsoluteMinute == null || target < this.lastAbsoluteMinute) {
      this.initializeAt(day, clockMinutes);
      return;
    }
    this._appendThrough(target);
    this.lastAbsoluteMinute = target;
  }

  _appendThrough(target) {
    const start = this.lastAbsoluteMinute == null ? target : this.lastAbsoluteMinute;
    for (let absolute = start; absolute <= target; absolute += 1) {
      const day = Math.floor(absolute / 1440);
      const minute = absolute % 1440;
      for (const checkpoint of CHECKPOINTS) {
        if (minute !== checkpoint.time || absolute !== target && absolute <= start) continue;
        this._appendSlot(day, checkpoint.time, checkpoint.suffix);
      }
    }
    if (this.lastAbsoluteMinute == null) {
      const day = Math.floor(target / 1440);
      const minute = target % 1440;
      for (const checkpoint of CHECKPOINTS) {
        if (minute >= checkpoint.time) this._appendSlot(day, checkpoint.time, checkpoint.suffix);
      }
    }
  }

  _appendSlot(day, time, suffix) {
    for (const queueId of ["work", "social"]) {
      const key = `${day}:${time}:${queueId}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      const sourceEntries = this.slots.get(key) || [];
      const entries = sourceEntries.map((entry) => ({
        ...entry,
        receivedDay: day,
        receivedTime: time,
        receivedPhase: time === 8 * 60 ? "day" : "night",
      }));
      if (queueId === "work") workQueue.append(entries);
      else socialQueue.append(entries);
    }
  }

  queue(queueId) {
    return queueId === "work" ? workQueue : socialQueue;
  }

  fileNameFor(day, phase) {
    const suffix = phase === "night" ? "b" : "a";
    return `work${String(Math.max(1, Number(day) || 1)).padStart(2, "0")}${suffix}.json`;
  }

  async load(day, phase) {
    await this.init();
    return {
      day,
      phase,
      patients: workQueue.getAll().map((item) => ({ ...item.payload, id: item.instanceId })),
      contacts: socialQueue.getAll().map((item) => ({ ...item.payload, id: item.instanceId })),
    };
  }

  async loadAllEntries() {
    await this.init();
    return [...this.slots.entries()].map(([key, entries]) => {
      const [, time, queueId] = key.split(":");
      return { key, data: queueId === "work" ? { patients: entries } : { contacts: entries } };
    });
  }

  hasPendingBatch(queueId, day, time) {
    return this.queue(queueId).hasPendingBatch(Number(day), Number(time));
  }

  history(queueId) {
    const grouped = new Map();
    this.queue(queueId).getAll().forEach((entry) => {
      const key = `${entry.receivedDay}:${entry.receivedTime}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });
    return [...grouped.entries()].map(([key, entries]) => {
      const [day, time] = key.split(":").map(Number);
      return { day, time, phase: time === 8 * 60 ? "day" : "night", entries };
    });
  }

  isFinalPhase(day, phase) {
    return phase === "night" && day >= this.totalDays;
  }
}

export const scheduleData = new ScheduleData();
export default ScheduleData;
