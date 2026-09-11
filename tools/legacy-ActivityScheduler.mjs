import { evaluateCondition } from "../core/ConditionEvaluator.js";

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
  constructor({ activityCalendar = null, contentDocumentStore = null, activityDefinitionStore, queueRegistry, context = {}, onAppend = null } = {}) {
    this.activityCalendar = activityCalendar || { slots: [] };
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
    for (const slot of Array.isArray(this.activityCalendar.slots) ? this.activityCalendar.slots : []) {
      const key = `${slot.day}:${slot.minutes}:${slot.queueId}`;
      const entries = this.slots.get(key) || [];
      entries.push({ activityId: slot.activityId, once: slot.once, prerequisites: slot.prerequisites });
      this.slots.set(key, entries);
    }
    if (!this.activityCalendar.slots?.length && this.contentDocumentStore) this._loadLegacyDocuments();
    this.refreshDefinitions();
    return this.catalog;
  }

  _loadLegacyDocuments() {
    for (let day = 1; day <= 7; day += 1) {
      for (const suffix of ["a", "b"]) {
        const minutes = suffix === "a" ? 480 : 960;
        for (const queueId of ["work", "social"]) {
          const id = `${queueId}${String(day).padStart(2, "0")}${suffix}`;
          const document = this.contentDocumentStore.get(id)?.document;
          for (const entry of document?.entries || []) {
            const key = `${day}:${minutes}:${queueId}`;
            const entries = this.slots.get(key) || [];
            entries.push({ activityId: entry.id, once: true, prerequisites: entry.prerequisites });
            this.slots.set(key, entries);
            this._registerEntry({ ...entry, id: entry.id, blueprint: entry.blueprint }, queueId, id, entries.length - 1);
          }
        }
      }
    }
  }

  /** Refresh definitions after lazy loading without rebuilding calendar slots. */
  refreshDefinitions() {
    this.activityDefinitionStore.list().forEach((definition, index) => {
      this._registerEntry(definition, definition.queueId || "main", `activities/${definition.id}.json`, index);
    });
    return this.catalog;
  }

  _registerEntry(entry, queueId, sourceFile, entryIndex) {
    if (!entry?.id) return;
    const activityId = entry.activityId || entry.id;
    const blueprint = entry.blueprint;
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
    // A definition may have been loaded lazily after the clock already
    // crossed this checkpoint. Re-check the current checkpoint so that the
    // late definition is still scheduled, while `fired` keeps this idempotent.
    for (const checkpoint of CHECKPOINTS) {
      if (minutes === checkpoint.minutes) this._appendSlot(Number(day), checkpoint.minutes, checkpoint.suffix);
    }
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
