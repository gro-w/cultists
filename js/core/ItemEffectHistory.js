import { eventBus } from "./EventBus.js";

function keyFor(itemId, effectId) {
  return `${String(itemId || "")}::${String(effectId || "")}`;
}

/** Persisted history of effects applied to a concrete item/object. */
class ItemEffectHistory {
  constructor() {
    this._applied = new Set();
  }

  record(itemId, effectId) {
    const key = keyFor(itemId, effectId);
    if (!itemId || !effectId || this._applied.has(key)) return false;
    this._applied.add(key);
    eventBus.emit("item-effect-history:changed", this.snapshot());
    return true;
  }

  has(itemId, effectId) {
    return this._applied.has(keyFor(itemId, effectId));
  }

  snapshot() {
    return [...this._applied];
  }

  restore(entries) {
    this._applied = new Set(Array.isArray(entries) ? entries.filter((entry) => typeof entry === "string") : []);
    eventBus.emit("item-effect-history:changed", this.snapshot());
  }
}

export const itemEffectHistory = new ItemEffectHistory();
export default ItemEffectHistory;
