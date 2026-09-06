import { convertLegacyBlueprint } from "./LegacyActivityAdapter.js";
import { evaluateCondition } from "./ConditionEvaluator.js";

const CHECKPOINTS = Object.freeze([
  { suffix: "a", minutes: 480 },
  { suffix: "b", minutes: 960 },
]);

/**
 * Generic calendar scheduler. It knows only queue IDs, day/minute slots,
 * authored entry metadata, and Activity definitions. Domain consequences stay
 * in blueprints/effect gateways.
 */
export class ActivityScheduler {
  constructor({ contentDocumentStore, activityDefinitionStore, queueRegistry, context = {}, onAppend = null } = {}) {
    this.contentDocumentStore = contentDocumentStore;
    this.activityDefinitionStore = activityDefinitionStore;
    this.queueRegistry = queueRegistry;
    this.context = context;
    this.slots = new Map();
    this.catalog = new Map();
    this.fired = new Set();
    this.lastAbsoluteMinute = null;
    this.diagnostics = [];
    this.onAppend = onAppend;
  }

  load() {
    for (const queueId of ["work", "social"]) {
      for (let day = 1; day <= 31; day += 1) {
        for (const checkpoint of CHECKPOINTS) {
          const id = `${queueId}${String(day).padStart(2, "0")}${checkpoint.suffix}`;
          const document = this.contentDocumentStore.get(id)?.document;
          if (!document) continue;
          const entries = Array.isArray(document.entries) ? document.entries : [];
          const key = `${day}:${checkpoint.minutes}:${queueId}`;
          this.slots.set(key, entries);
          entries.forEach((entry, entryIndex) => this._registerEntry(entry, queueId, `${id}.json`, entryIndex));
        }
      }
    }
    for (const queueId of ["work", "social", "main"]) {
      const id = `${queueId}pub`;
      const document = this.contentDocumentStore.get(id)?.document;
      const entries = Array.isArray(document?.entries) ? document.entries : [];
      entries.forEach((entry, entryIndex) => this._registerEntry(entry, queueId, `${id}.json`, entryIndex));
    }
    const mainInit = this.contentDocumentStore.get("maininit")?.document;
    for (const entry of Array.isArray(mainInit?.entries) ? mainInit.entries : []) this._registerEntry({ ...entry, autoRun: true }, "main", "maininit.json", 0);
    return this.catalog;
  }

  _registerEntry(entry, queueId, sourceFile, entryIndex) {
    if (!entry?.id) return;
    const activityId = entry.activityId || entry.id;
    const rawBlueprint = entry.blueprint || entry.dialogueTree;
    let blueprint = rawBlueprint;
    if (rawBlueprint) {
      const result = convertLegacyBlueprint(rawBlueprint);
      if (!result.ok) {
        this.diagnostics.push({ activityId, sourceFile, entryIndex, blockedTypes: result.blockedTypes, errors: result.errors });
        return;
      }
      blueprint = result.blueprint;
    }
    if (blueprint) {
      try { this.activityDefinitionStore.register({ ...entry, id: activityId, blueprint, queueId }); }
      catch (error) { this.diagnostics.push({ activityId, sourceFile, entryIndex, errors: [error.message] }); return; }
    }
    this.catalog.set(activityId, { id: activityId, queueId, sourceFile, entryIndex, entry: { ...entry, activityId, blueprint } });
  }

  advanceTo(day, minutes) {
    const target = (Number(day) - 1) * 1440 + Number(minutes);
    if (this.lastAbsoluteMinute != null && target < this.lastAbsoluteMinute) {
      this.fired.clear();
    }
    const start = this.lastAbsoluteMinute == null ? 0 : this.lastAbsoluteMinute + 1;
    for (let absolute = start; absolute <= target; absolute += 1) {
      const currentDay = Math.floor(absolute / 1440) + 1;
      const currentMinutes = absolute % 1440;
      for (const checkpoint of CHECKPOINTS) {
        if (currentMinutes === checkpoint.minutes) this._appendSlot(currentDay, checkpoint.minutes, checkpoint.suffix);
      }
    }
    this.lastAbsoluteMinute = target;
  }

  _appendSlot(day, minutes, suffix) {
    for (const queueId of ["work", "social"]) {
      const key = `${day}:${minutes}:${queueId}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      const queue = this.queueRegistry.get(queueId) || this.queueRegistry.register(queueId);
      for (const source of this.slots.get(key) || []) {
        const activityId = source.activityId || source.id;
        const catalog = this.catalog.get(activityId);
        if (!catalog || !this._available(catalog.entry)) continue;
        if (queue.countByActivity(activityId) > 0 && source.once !== false) continue;
        const instance = queue.append({
          activityId,
          receivedDay: day,
          receivedTime: minutes,
          receivedPhase: suffix === "a" ? "day" : "night",
          payload: { ...catalog.entry, activityId },
          currentNodeId: catalog.entry.blueprint?.startNodeId || null,
        });
        this.onAppend?.({ queue, instance, definition: this.activityDefinitionStore.get(activityId), source: catalog });
      }
    }
  }

  _available(entry) {
    const condition = entry.prerequisites || entry.condition || entry.globalVariableCondition;
    return !condition || evaluateCondition(condition, this.context);
  }

  snapshot() {
    return { fired: [...this.fired], lastAbsoluteMinute: this.lastAbsoluteMinute };
  }

  restore(snapshot = {}) {
    this.fired = new Set(Array.isArray(snapshot.fired) ? snapshot.fired : []);
    this.lastAbsoluteMinute = snapshot.lastAbsoluteMinute == null ? null : Number(snapshot.lastAbsoluteMinute);
  }
}

export default ActivityScheduler;
