import { dataLoader } from "./DataLoader.js";
import { specialEventManager } from "./SpecialEventManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { calendarData } from "./CalendarData.js";
import { gameState } from "./GameState.js";
import { workQueue, socialQueue, chatgtpQueue, realtimeQueue } from "./ScheduleQueue.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { itemManager } from "./ItemManager.js";
import { MAX_GAME_DAYS } from "./GameRules.js";

const CHECKPOINTS = [
  { suffix: "a", time: 8 * 60 },
  { suffix: "b", time: 16 * 60 },
];

class ScheduleData {
  constructor() {
    this.totalDays = MAX_GAME_DAYS;
    this.slots = new Map();
    this.fired = new Set();
    this.scheduleById = new Map();
    this.scheduleCatalog = new Map();
    this.publicEntries = new Map();
    this.pendingAdds = [];
    this.lastAbsoluteMinute = null;
    this._initPromise = null;
  }

  async init() {
    if (!this._initPromise) this._initPromise = this._loadAll();
    return this._initPromise;
  }

  async _loadAll() {
    await Promise.all([calendarData.init(), globalVariableManager.init(), itemManager.load()]);
    this.totalDays = Math.min(MAX_GAME_DAYS, calendarData.totalDays);
    const requests = [];
    for (let day = 1; day <= this.totalDays; day += 1) {
      for (const checkpoint of CHECKPOINTS) {
        for (const queueId of ["work", "social"]) {
          const file = `${queueId}${String(day).padStart(2, "0")}${checkpoint.suffix}.json`;
          requests.push(dataLoader.loadJSON(file).then((data) => {
            const entries = Array.isArray(data.entries) ? data.entries : [];
            this.slots.set(`${day}:${checkpoint.time}:${queueId}`, entries);
            this._indexEntries(entries, queueId, "calendar", file.replace(/\.json$/, ""));
          }));
        }
      }
    }
    for (const queueId of ["work", "social"]) {
      requests.push(dataLoader.loadJSON(`${queueId}pub.json`).then((data) => {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        this.publicEntries.set(queueId, entries);
        this._indexEntries(entries, queueId, "public", `${queueId}pub`);
      }));
    }
    await Promise.all(requests);
    const [specialEvents, endings] = await Promise.all([
      specialEventManager.load(),
      dataLoader.loadJSON("endings.json"),
      favorabilityManager.load(),
      npcStateManager.load(),
    ]).then(([events, endingDoc]) => [events, endingDoc]);
    this._indexExternalEntries(specialEventManager.events, "social", "special", "special_events");
    this._indexExternalEntries((endings.endings || []).map((ending) => ({
      ...ending,
      blueprint: ending.blueprint || ending.dialogueTree || {
        startNodeId: "start",
        nodes: {
          start: { id: "start", type: "flowStart" },
          text: { id: "text", type: "text", inputs: { speaker: "narrator", text: ending.text || ending.title || "" } },
        },
        connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "text", toPort: "flowIn" }],
      },
    })), "social", "ending", "endings");
    for (const def of itemManager.defs.values()) {
      Object.values(def.schedules || def.scheduleTable || {}).forEach((schedule) => {
        const entries = Array.isArray(schedule?.entries) ? schedule.entries : [schedule];
        this._indexExternalEntries(entries.filter((entry) => entry && entry.id), "realtime", "embedded");
      });
    }
    this.initializeAt(gameState.day, gameState.clockMinutes);
  }

  _indexExternalEntries(entries, defaultQueueId, category = "calendar", sourceFile = undefined) {
    (entries || []).forEach((entry, entryIndex) => {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) return;
      if (this.scheduleById.has(entry.id)) throw new Error(`Duplicate schedule id: ${entry.id}`);
      const definition = { ...entry, queueId: entry.queueId || defaultQueueId };
      this.scheduleById.set(entry.id, definition);
      this.scheduleCatalog.set(entry.id, { id: entry.id, category, queueId: definition.queueId, sourceFile, entryIndex });
    });
  }

  _indexEntries(entries, queueId, category = "calendar", sourceFile = undefined) {
    entries.forEach((entry, entryIndex) => {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) {
        throw new Error(`Schedule entry in ${queueId} needs a stable string id`);
      }
      if (this.scheduleById.has(entry.id)) throw new Error(`Duplicate schedule id: ${entry.id}`);
      this.scheduleById.set(entry.id, { ...entry, queueId });
      this.scheduleCatalog.set(entry.id, { id: entry.id, category, queueId, sourceFile, entryIndex });
    });
  }

  initializeAt(day, clockMinutes) {
    this.fired.clear();
    this.pendingAdds = [];
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
    this._appendScheduledThrough(target);
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
      const entries = sourceEntries
        .filter((entry) => {
          if (!this.matchesPrerequisites(entry.prerequisites || entry.condition || entry.globalVariableCondition)) return false;
          // special and ending schedules are one-shot: skip if already queued (any status).
          const cat = this.scheduleCatalog.get(entry.scheduleId || entry.id)?.category;
          if (cat === "special" || cat === "ending") {
            const sid = entry.scheduleId || entry.id;
            const q = queueId === "work" ? workQueue : socialQueue;
            if (q.countBySchedule(sid) > 0) return false;
          }
          return true;
        })
        .map((entry) => ({
          ...entry,
          scheduleId: entry.scheduleId || entry.id,
          receivedDay: day,
          receivedTime: time,
          receivedPhase: time === 8 * 60 ? "day" : "night",
        }));
      if (queueId === "work") workQueue.append(entries);
      else socialQueue.append(entries);
    }
  }

  _appendScheduledThrough(target) {
    const ready = this.pendingAdds.filter((request) => request.addTime <= target);
    this.pendingAdds = this.pendingAdds.filter((request) => request.addTime > target);
    ready.sort((a, b) => a.addTime - b.addTime);
    ready.forEach((request) => {
      const definition = this.scheduleById.get(request.scheduleId);
      if (!definition || !this.matchesPrerequisites(definition.prerequisites || definition.condition)) return;
      const day = Math.floor(request.addTime / 1440);
      const time = request.addTime % 1440;
      const entry = { ...definition, scheduleId: definition.id, receivedDay: day, receivedTime: time,
        receivedPhase: time < 16 * 60 ? "day" : "night" };
      delete entry.queueId;
      this.queue(request.queueId || definition.queueId).append([entry]);
      this._applyScheduleOperations(entry);
    });
  }

  matchesPrerequisites(condition) {
    if (!condition) return true;
    if (Array.isArray(condition)) return condition.every((item) => this.matchesPrerequisites(item));
    if (condition.all) return condition.all.every((item) => this.matchesPrerequisites(item));
    if (condition.any) return condition.any.some((item) => this.matchesPrerequisites(item));
    if (condition.scheduleCompleted !== undefined) return workQueue.hasCompletedId(condition.scheduleCompleted) || socialQueue.hasCompletedId(condition.scheduleCompleted);
    if (condition.globalVariables) return globalVariableManager.matches(condition.globalVariables);
    if (condition.protagonist) return this._matchesValue(gameState[condition.protagonist.stat], condition.protagonist);
    if (condition.npc) {
      const source = condition.npc.stat === "favorability" ? favorabilityManager.get(condition.npc.npcId) : npcStateManager.get(condition.npc.npcId);
      return this._matchesValue(source, condition.npc);
    }
    if (condition.item || condition.items) {
      const items = condition.item ? [condition.item] : condition.items;
      return (Array.isArray(items) ? items : [items]).every((item) => {
        const held = itemManager.has(item.itemId, item.count || 1);
        return item.held === undefined ? held : Boolean(item.held) === held;
      });
    }
    return globalVariableManager.matches(condition);
  }

  _matchesValue(actual, condition) {
    const expected = Object.hasOwn(condition, "equals") ? condition.equals : condition.value;
    const op = condition.op || "eq";
    if (op === "eq") return actual === expected;
    if (op === "neq") return actual !== expected;
    if (op === "gt") return actual > expected;
    if (op === "gte") return actual >= expected;
    if (op === "lt") return actual < expected;
    if (op === "lte") return actual <= expected;
    return false;
  }

  _applyScheduleOperations(entry) {
    const effects = entry?.operations ? entry : (entry?.effects || entry?.onAdd || {});
    const operations = [
      ...(Array.isArray(effects.operations) ? effects.operations : []),
      ...(effects.addSchedule ? (Array.isArray(effects.addSchedule) ? effects.addSchedule : [effects.addSchedule]) : []),
    ];
    operations.forEach((operation) => {
      if (operation?.type === "addSchedule" || operation?.scheduleId) {
        const addTime = operation.addTime ?? (Number.isInteger(Number(operation.day)) && Number.isInteger(Number(operation.time))
          ? Number(operation.day) * 1440 + Number(operation.time) : undefined);
        this.addSchedule(operation.scheduleId, addTime);
      }
    });
  }

  addSchedule(scheduleId, addTime, queueId = undefined) {
    const definition = this.scheduleById.get(scheduleId);
    if (!definition) return { ok: false, reason: "unknownSchedule" };
    const target = Number(addTime);
    const maxAbsoluteMinute = MAX_GAME_DAYS * 1440 + 1439;
    if (!Number.isInteger(target) || target < 0 || target > maxAbsoluteMinute || target % 20 !== 0) return { ok: false, reason: "invalidAddTime" };
    if (queueId !== undefined && !["work", "social", "chatgtp", "realtime"].includes(queueId)) return { ok: false, reason: "invalidQueue" };
    const request = { scheduleId, addTime: target, ...(queueId ? { queueId } : {}) };
    this.pendingAdds.push(request);
    if (this.lastAbsoluteMinute != null && target <= this.lastAbsoluteMinute) this._appendScheduledThrough(this.lastAbsoluteMinute);
    return { ok: true, request };
  }

  queue(queueId) {
    return { work: workQueue, social: socialQueue, chatgtp: chatgtpQueue, realtime: realtimeQueue }[queueId] || socialQueue;
  }

  catalog(category = undefined) {
    return [...this.scheduleCatalog.values()]
      .filter((entry) => !category || entry.category === category)
      .map((entry) => ({ ...entry, definition: this.scheduleById.get(entry.id) }))
      .filter((entry) => entry.definition)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async createInstance(scheduleId, queueId = undefined, received = {}) {
    await this.init();
    const definition = this.scheduleById.get(scheduleId);
    if (!definition) return { ok: false, reason: "unknownSchedule" };
    const targetQueueId = queueId || definition.queueId || "social";
    const day = Number.isInteger(received.day) ? received.day : gameState.day;
    const time = Number.isInteger(received.time) ? received.time : gameState.clockMinutes;
    const entry = {
      ...JSON.parse(JSON.stringify(definition)),
      scheduleId,
      receivedDay: day,
      receivedTime: time,
      receivedPhase: time < 16 * 60 ? "day" : "night",
      status: "unresolved",
      currentNodeId: definition.blueprint?.startNodeId || null,
      transcript: [],
    };
    delete entry.queueId;
    const [instance] = this.queue(targetQueueId).append(entry);
    return { ok: true, queueId: targetQueueId, instance };
  }

  createTemporaryInstance(blueprint, queueId = undefined, received = {}) {
    const day = Number.isInteger(received.day) ? received.day : gameState.day;
    const time = Number.isInteger(received.time) ? received.time : gameState.clockMinutes;
    const targetQueueId = queueId || "social";
    const scheduleId = `temporary:${Date.now()}`;
    const [instance] = this.queue(targetQueueId).append({
      scheduleId,
      payload: { id: scheduleId, blueprint: JSON.parse(JSON.stringify(blueprint)) },
      receivedDay: day,
      receivedTime: time,
      receivedPhase: time < 16 * 60 ? "day" : "night",
      status: "unresolved",
      currentNodeId: blueprint?.startNodeId || null,
      transcript: [],
    });
    return { ok: true, queueId: targetQueueId, instance };
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
    const entries = [...this.slots.entries()].map(([key, slotEntries]) => {
      const [, time, queueId] = key.split(":");
      return { key, data: queueId === "work" ? { patients: slotEntries } : { contacts: slotEntries } };
    });
    this.publicEntries.forEach((slotEntries, queueId) => {
      entries.push({ key: `public:${queueId}`, data: queueId === "work" ? { patients: slotEntries } : { contacts: slotEntries } });
    });
    return entries;
  }

  snapshotScheduled() {
    return this.pendingAdds.map((entry) => ({ ...entry }));
  }

  restoreScheduled(entries = []) {
    this.pendingAdds = Array.isArray(entries)
      ? entries.filter((entry) => this.scheduleById.has(entry?.scheduleId)).map((entry) => ({ ...entry }))
      : [];
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
