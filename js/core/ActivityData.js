import { dataLoader } from "./DataLoader.js";
import { specialEventManager } from "./SpecialEventManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { calendarData } from "./CalendarData.js";
import { gameState } from "./GameState.js";
import { workQueue, socialQueue, mainQueue } from "./ActivityQueue.js";
import { activityQueueRegistry } from "./ActivityQueueRegistry.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { itemManager } from "./ItemManager.js";
import { MAX_GAME_DAYS } from "./GameRules.js";
import { validateBlueprint, embedLegacyPrerequisite } from "./ActivityBlueprint.js";
import { ActivityValueEvaluator } from "./ActivityValueEvaluator.js";
import { eventBus } from "./EventBus.js";
import { selectWorkEntries } from "./GameMode.js";

const CHECKPOINTS = [
  { suffix: "a", time: 8 * 60 },
  { suffix: "b", time: 16 * 60 },
];

function inRange(value, min, max) {
  return (min == null || value >= Number(min)) && (max == null || value <= Number(max));
}

class ActivityData {
  constructor() {
    this.totalDays = MAX_GAME_DAYS;
    this.slots = new Map();
    this.fired = new Set();
    this.activityById = new Map();
    this.activityCatalog = new Map();
    this.publicEntries = new Map();
    this.pendingAdds = [];
    this.lastAbsoluteMinute = null;
    this._initPromise = null;
    this._autoSpecialEventOff = eventBus.on("game:sanity_changed", () => {
      if (this._initPromise) this._appendAutoSpecialEvents();
    });
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
    for (const queueId of ["work", "social", "main"]) {
      requests.push(dataLoader.loadJSON(`${queueId}pub.json`).then((data) => {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        this.publicEntries.set(queueId, entries);
        this._indexEntries(entries, queueId, "public", `${queueId}pub`);
      }));
    }
    await Promise.all(requests);
    const mainInit = await dataLoader.loadJSON("maininit.json");
    const mainEntries = Array.isArray(mainInit.entries) ? mainInit.entries.map((entry) => ({
      ...entry,
      queueId: "main",
      autoRun: true,
    })) : [];
    this._indexExternalEntries(mainEntries, "main", "main-init", "maininit");
    mainQueue.append(mainEntries);
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
      Object.values(def.activities || def.activityTable || {}).forEach((activity) => {
        const entries = Array.isArray(activity?.entries) ? activity.entries : [activity];
        this._indexExternalEntries(entries.filter((entry) => entry && entry.id), "main", "embedded");
      });
    }
    this.initializeAt(gameState.day, gameState.clockMinutes);
  }

  _appendAutoSpecialEvents() {
    for (const event of specialEventManager.events) {
      if (!event?.autoTrigger || event.queueId && event.queueId !== "social") continue;
      if (event.phase !== "day" || !inRange(gameState.day, event.startDay, event.endDay)) continue;
      const condition = event.condition || event.globalVariableCondition;
      const matchesSanity = condition?.id === 1
        ? this._matchesValue(gameState.sanity, condition)
        : globalVariableManager.matches(condition);
      if (!matchesSanity || socialQueue.countByActivity(event.id) > 0) continue;
      socialQueue.append([{
        ...event,
        activityId: event.id,
        receivedDay: gameState.day,
        receivedTime: gameState.clockMinutes,
        receivedPhase: gameState.phase,
        status: "unresolved",
        currentNodeId: event.blueprint?.startNodeId || null,
        transcript: [],
      }]);
    }
  }

  _indexExternalEntries(entries, defaultQueueId, category = "calendar", sourceFile = undefined) {
    (entries || []).forEach((entry, entryIndex) => {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) return;
      if (this.activityById.has(entry.id)) throw new Error(`Duplicate activity id: ${entry.id}`);
      const definition = { ...entry, queueId: entry.queueId || defaultQueueId };
      this.activityById.set(entry.id, definition);
      this.activityCatalog.set(entry.id, { id: entry.id, category, queueId: definition.queueId, sourceFile, entryIndex });
    });
  }

  _indexEntries(entries, queueId, category = "calendar", sourceFile = undefined) {
    entries.forEach((entry, entryIndex) => {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) {
        throw new Error(`Activity entry in ${queueId} needs a stable string id`);
      }
      if (this.activityById.has(entry.id)) throw new Error(`Duplicate activity id: ${entry.id}`);
      this.activityById.set(entry.id, { ...entry, queueId });
      this.activityCatalog.set(entry.id, { id: entry.id, category, queueId, sourceFile, entryIndex });
    });
  }

  initializeAt(day, clockMinutes) {
    this.fired.clear();
    this.pendingAdds = [];
    this.lastAbsoluteMinute = null;
    const target = Number(day) * 1440 + Number(clockMinutes);
    this._appendThrough(target);
    this.lastAbsoluteMinute = target;
    this._appendAutoSpecialEvents();
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
    this._expireInstances(target);
    this._appendAutoSpecialEvents();
  }

  advanceTo(day, clockMinutes) {
    const target = Number(day) * 1440 + Number(clockMinutes);
    if (this.lastAbsoluteMinute == null || target < this.lastAbsoluteMinute) {
      this.initializeAt(day, clockMinutes);
      return;
    }
    this._appendThrough(target);
    this._appendQueuedThrough(target);
    this._expireInstances(target);
    this._appendAutoSpecialEvents();
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
      const sourceEntries = selectWorkEntries(this.slots.get(key) || [], queueId);
      const entries = sourceEntries
        .filter((entry) => {
          if (queueId === "social" && !this.matchesPrerequisite(entry.blueprint || entry.dialogueTree, entry.insertPrerequisite)) return false;
          if (!this.matchesPrerequisites(entry.prerequisites || entry.condition || entry.globalVariableCondition)) return false;
          // special and ending activities are one-shot: skip if already queued (any status).
          const cat = this.activityCatalog.get(entry.activityId || entry.id)?.category;
          if (cat === "special" || cat === "ending") {
            const sid = entry.activityId || entry.id;
            const q = queueId === "work" ? workQueue : socialQueue;
            if (q.countByActivity(sid) > 0) return false;
          }
          return true;
        })
        .map((entry) => ({
          ...entry,
          activityId: entry.activityId || entry.id,
          receivedDay: day,
          receivedTime: time,
          receivedPhase: time === 8 * 60 ? "day" : "night",
        }));
      if (queueId === "work") workQueue.append(entries);
      else socialQueue.append(entries);
    }
    // The flag is consumed by the next day's 08:00 social slot. Clear it only
    // after that slot has been evaluated, so it means "spoke yesterday".
    if (time === 8 * 60) {
      for (const id of [100, 101]) if (globalVariableManager.definition(id)) globalVariableManager.set(id, false);
    }
  }

  enqueueMedicalIncident({ submission, type }) {
    const activityId = type === "riot" ? "medical_riot_work" : "medical_complaint_work";
    const template = this.publicEntries.get("work")?.find((entry) => entry.id === activityId);
    if (!template) return { ok: false, reason: "missingMedicalIncidentTemplate" };
    const entry = JSON.parse(JSON.stringify(template));
    entry.kind = "medicalIncident";
    entry.incidentType = type;
    entry.submission = submission;
    entry.receivedDay = submission.dueDay;
    entry.receivedTime = submission.dueTime ?? (type === "riot" ? 16 * 60 : 8 * 60);
    entry.receivedPhase = entry.receivedTime >= 16 * 60 ? "night" : "day";
    entry.activityId = `${template.id}:${submission.patientId}`;
    workQueue.append([entry]);
    return { ok: true, activityId: entry.activityId };
  }

  matchesPrerequisite(rawBlueprint, legacyPrerequisite = null) {
    if (!rawBlueprint && !legacyPrerequisite) return true;
    const blueprint = embedLegacyPrerequisite(rawBlueprint || {}, legacyPrerequisite);
    const validation = validateBlueprint(blueprint);
    if (!validation.ok) {
      console.warn("Skipped invalid social prerequisite:", validation.errors);
      return false;
    }
    try {
      const prerequisite = Object.values(validation.blueprint.nodes).find((node) => node.type === "prerequisite");
      if (!prerequisite) return true;
      return new ActivityValueEvaluator(validation.blueprint).readInput(prerequisite.id, "condition", false) === true;
    } catch (error) {
      console.warn("Skipped social prerequisite evaluation:", error);
      return false;
    }
  }

  _expireInstances(target) {
    for (const queue of activityQueueRegistry.all()) {
      for (const instance of queue.getPending()) {
        const blueprint = instance.payload?.blueprint || instance.blueprint || instance.payload?.dialogueTree || instance.dialogueTree;
        const node = Object.values(blueprint?.nodes || {}).find((candidate) => candidate.type === "activityExpiry");
        if (!node || instance.protectFromExpiry === true || instance.payload?.protectFromExpiry === true) continue;
        try {
          const evaluator = new ActivityValueEvaluator(blueprint);
          if (evaluator.readInput(node.id, "expires", false) !== true) continue;
          const expiresAt = Number(evaluator.readInput(node.id, "expiresAt", NaN));
          if (Number.isFinite(expiresAt) && target > expiresAt) queue.expire(instance.instanceId);
        } catch (error) {
          console.warn("Skipped activity expiration evaluation:", error);
        }
      }
    }
  }

  _appendQueuedThrough(target) {
    const ready = this.pendingAdds.filter((request) => request.addTime <= target);
    this.pendingAdds = this.pendingAdds.filter((request) => request.addTime > target);
    ready.sort((a, b) => a.addTime - b.addTime);
    ready.forEach((request) => {
      const definition = this.activityById.get(request.activityId);
      if (!definition) return;
      if (request.respectPrerequisite !== false
        && ((definition.blueprint || definition.dialogueTree || definition.insertPrerequisite)
          && !this.matchesPrerequisite(definition.blueprint || definition.dialogueTree, definition.insertPrerequisite)
          || !this.matchesPrerequisites(definition.prerequisites || definition.condition))) return;
      const day = Math.floor(request.addTime / 1440);
      const time = request.addTime % 1440;
      const entry = { ...definition, activityId: definition.id, receivedDay: day, receivedTime: time,
        receivedPhase: time < 16 * 60 ? "day" : "night",
        ...(request.protectFromExpiry === true ? { protectFromExpiry: true } : {}) };
      delete entry.queueId;
      const targetQueueId = request.queueId || definition.queueId;
      if (targetQueueId === "main") entry.autoRun = true;
      this.queue(targetQueueId).append([entry]);
      this._applyActivityOperations(entry);
    });
  }

  matchesPrerequisites(condition) {
    if (!condition) return true;
    if (Array.isArray(condition)) return condition.every((item) => this.matchesPrerequisites(item));
    if (condition.all) return condition.all.every((item) => this.matchesPrerequisites(item));
    if (condition.any) return condition.any.some((item) => this.matchesPrerequisites(item));
    if (condition.activityCompleted !== undefined) return workQueue.hasCompletedId(condition.activityCompleted) || socialQueue.hasCompletedId(condition.activityCompleted);
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

  _applyActivityOperations(entry) {
    const effects = entry?.operations ? entry : (entry?.effects || entry?.onAdd || {});
    const operations = [
      ...(Array.isArray(effects.operations) ? effects.operations : []),
      ...(effects.addActivity ? (Array.isArray(effects.addActivity) ? effects.addActivity : [effects.addActivity]) : []),
    ];
    operations.forEach((operation) => {
      if (operation?.type === "addActivity" || operation?.activityId) {
        const addTime = operation.addTime ?? (Number.isInteger(Number(operation.day)) && Number.isInteger(Number(operation.time))
          ? Number(operation.day) * 1440 + Number(operation.time) : undefined);
        this.addActivity(operation.activityId, addTime, operation.queueId || operation.queue, {
          respectPrerequisite: operation.respectPrerequisite,
          protectFromExpiry: operation.protectFromExpiry,
        });
      }
    });
  }

  addActivity(activityId, addTime, queueId = undefined, options = {}) {
    const definition = this.activityById.get(activityId);
    if (!definition) return { ok: false, reason: "unknownActivity" };
    const target = Number(addTime);
    const maxAbsoluteMinute = MAX_GAME_DAYS * 1440 + 1439;
    if (!Number.isInteger(target) || target < 0 || target > maxAbsoluteMinute || target % 20 !== 0) return { ok: false, reason: "invalidAddTime" };
    if (queueId !== undefined && !activityQueueRegistry.has(queueId)) return { ok: false, reason: "invalidQueue" };
    const request = {
      activityId,
      addTime: target,
      ...(queueId ? { queueId } : {}),
      respectPrerequisite: options.respectPrerequisite !== false,
      protectFromExpiry: options.protectFromExpiry === true,
    };
    this.pendingAdds.push(request);
    if (this.lastAbsoluteMinute != null && target <= this.lastAbsoluteMinute) this._appendQueuedThrough(this.lastAbsoluteMinute);
    return { ok: true, request };
  }

  queue(queueId) {
    return activityQueueRegistry.get(queueId);
  }

  definition(activityId) {
    return this.activityById.get(activityId) || null;
  }

  catalog(category = undefined) {
    return [...this.activityCatalog.values()]
      .filter((entry) => !category || entry.category === category)
      .map((entry) => ({ ...entry, definition: this.activityById.get(entry.id) }))
      .filter((entry) => entry.definition)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async createInstance(activityId, queueId = undefined, received = {}) {
    await this.init();
    const definition = this.activityById.get(activityId);
    if (!definition) return { ok: false, reason: "unknownActivity" };
    const targetQueueId = queueId || definition.queueId || "main";
    const day = Number.isInteger(received.day) ? received.day : gameState.day;
    const time = Number.isInteger(received.time) ? received.time : gameState.clockMinutes;
    const entry = {
      ...JSON.parse(JSON.stringify(definition)),
      activityId,
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
    const targetQueueId = queueId || "main";
    const activityId = `temporary:${Date.now()}`;
    const [instance] = this.queue(targetQueueId).append({
      activityId,
      payload: { id: activityId, blueprint: JSON.parse(JSON.stringify(blueprint)) },
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

  snapshotQueued() {
    return this.pendingAdds.map((entry) => ({ ...entry }));
  }

  restoreQueued(entries = []) {
    this.pendingAdds = Array.isArray(entries)
      ? entries.filter((entry) => this.activityById.has(entry?.activityId)).map((entry) => ({ ...entry }))
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

export const activityData = new ActivityData();
export default ActivityData;
