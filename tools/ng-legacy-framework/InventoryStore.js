/**
 * Generic inventory and placement store.
 * Item definitions and item-specific actions remain authored data; this class
 * only owns quantities, placements, events, and persistence.
 */
export class InventoryStore {
  constructor({ eventBus, eventPrefix = "item" } = {}) {
    this.eventBus = eventBus;
    this.eventPrefix = eventPrefix;
    this.inventory = new Map();
    this.placements = new Map();
  }

  has(id, count = 1) { return this.count(id) >= Math.max(0, Number(count) || 0); }
  count(id) { return this.inventory.get(String(id)) || 0; }
  add(id, count = 1) {
    const key = String(id);
    this.inventory.set(key, this.count(key) + Math.max(0, Number(count) || 0));
    this.eventBus?.emit("inventory:changed", this.inventorySnapshot());
    return this.count(key);
  }
  remove(id, count = 1) {
    const key = String(id);
    const next = Math.max(0, this.count(key) - Math.max(0, Number(count) || 0));
    if (next) this.inventory.set(key, next); else this.inventory.delete(key);
    this.eventBus?.emit("inventory:changed", this.inventorySnapshot());
    return next;
  }
  inventorySnapshot() { return Object.fromEntries(this.inventory); }
  place(placementId, itemId, metadata = {}) {
    const value = { id: String(placementId), itemId: String(itemId), ...structuredClone(metadata) };
    this.placements.set(value.id, value);
    this.eventBus?.emit("itemPlacement:changed", this.placementsSnapshot());
    return structuredClone(value);
  }
  pickUp(placementId) {
    const key = String(placementId);
    const placement = this.placements.get(key);
    if (!placement) return null;
    this.placements.delete(key);
    this.add(placement.itemId, 1);
    return structuredClone(placement);
  }
  placementsSnapshot() { return [...this.placements.values()].map((value) => structuredClone(value)); }
  snapshot() { return { inventory: this.inventorySnapshot(), placements: this.placementsSnapshot() }; }
  restore(snapshot = {}) {
    this.inventory = new Map(Object.entries(snapshot.inventory || {}));
    this.placements = new Map((snapshot.placements || []).map((value) => [String(value.id), structuredClone(value)]));
  }
}

export default InventoryStore;
