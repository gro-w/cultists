/**
 * Generic event-rule state store. Rules, event names, conditions and actions
 * are supplied by content; Core owns matching, progress, unlock state, and
 * persistence only.
 */
export class EventRuleStore {
  constructor({ eventBus, records = [], eventPrefix = "rule", idField = "recordId", onUnlock = null } = {}) {
    this.eventBus = eventBus;
    this.records = new Map(records.map((record) => [record.id, record]));
    this.unlocked = new Set();
    this.progress = new Map();
    this.eventPrefix = eventPrefix;
    this.idField = idField;
    this.onUnlock = onUnlock;
    this.unsubscribe = [];
    [...new Set(records.map((record) => record.trigger?.event).filter(Boolean))]
      .forEach((eventName) => this.unsubscribe.push(eventBus.on(eventName, (payload) => this.handle(eventName, payload || {}))));
  }

  handle(eventName, payload) {
    this.records.forEach((record) => {
      const trigger = record.trigger || {};
      if (trigger.event !== eventName || this.unlocked.has(record.id) || !matches(trigger.condition, payload)) return;
      if (trigger.progress) {
        const key = trigger.progressKey || record.id;
        const delta = trigger.progressDelta === "delta_abs"
          ? Math.abs(Number(payload.delta || 0))
          : Number(payload[trigger.progressDelta || "amount"] ?? 1);
        const next = (this.progress.get(key) || 0) + (Number.isFinite(delta) ? delta : 0);
        this.progress.set(key, next);
        if (next < Number(trigger.target || 1)) return;
      }
      this.unlock(record.id, payload);
    });
  }

  unlock(id, payload = {}) {
    if (this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    this.eventBus.emit(`${this.eventPrefix}:unlocked`, { [this.idField]: id, payload });
    this.onUnlock?.(id, payload);
    return true;
  }

  snapshot() { return { unlocked: [...this.unlocked], progress: [...this.progress.entries()] }; }
  restore(snapshot = {}) {
    this.unlocked = new Set(snapshot.unlocked || []);
    this.progress = new Map(snapshot.progress || []);
  }
}

function matches(condition, payload) {
  if (!condition) return true;
  return Object.entries(condition).every(([key, expected]) => {
    if (key === "all") return expected.every((item) => matches(item, payload));
    if (key === "any") return expected.some((item) => matches(item, payload));
    const actual = payload[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return Object.entries(expected).every(([op, value]) => op === "eq" ? actual === value : op === "neq" ? actual !== value : op === "gt" ? actual > value : op === "gte" ? actual >= value : op === "lt" ? actual < value : op === "lte" ? actual <= value : false);
    }
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

export default EventRuleStore;
