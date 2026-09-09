import RuntimeRecordStore from "../../ng/core/RuntimeRecordStore.js";

export class ItemManager extends RuntimeRecordStore {
  constructor(options = {}) {
    super({ ...options, eventPrefix: "item" });
    this.inventory = new Map();
    this.placements = new Map();
    this.definitions = new Map();
  }
  loadDefinitions(records = []) {
    for (const record of records) {
      if (record?.id) this.definitions.set(String(record.id), structuredClone(record));
    }
    return this.definitions.size;
  }
  getDefinition(itemId) { return this.definitions.get(String(itemId)) || null; }
  allDefinitions() { return [...this.definitions.values()].map((value) => structuredClone(value)); }
  has(itemId, count = 1) { return this.count(itemId) >= Math.max(0, Number(count) || 0); }
  activityFor(itemId, action) { return this.getDefinition(itemId)?.activities?.[action] || null; }
  canUse(itemId) {
    const definition = this.getDefinition(itemId);
    return Boolean(definition?.usable && this.has(itemId));
  }
  use(itemId, count = 1) {
    const definition = this.getDefinition(itemId);
    if (!definition) return { ok: false, reason: "unknown-item", itemId: String(itemId) };
    if (!definition.usable) return { ok: false, reason: "not-usable", itemId: String(itemId) };
    if (!this.has(itemId, count)) return { ok: false, reason: "not-owned", itemId: String(itemId) };
    if (definition.consumable) this.remove(itemId, count);
    const result = { ok: true, itemId: String(itemId), action: "use", activity: this.activityFor(itemId, "use") };
    this.eventBus?.emit("item:used", result);
    return result;
  }
  add(itemId, count = 1) { const key = String(itemId); this.inventory.set(key, (this.inventory.get(key) || 0) + Math.max(0, count)); this.eventBus?.emit("inventory:changed", this.inventorySnapshot()); return this.inventory.get(key); }
  remove(itemId, count = 1) { const key = String(itemId); const next = Math.max(0, (this.inventory.get(key) || 0) - Math.max(0, count)); if (next) this.inventory.set(key, next); else this.inventory.delete(key); this.eventBus?.emit("inventory:changed", this.inventorySnapshot()); return next; }
  count(itemId) { return this.inventory.get(String(itemId)) || 0; }
  inventorySnapshot() { return Object.fromEntries(this.inventory); }
  place(placementId, itemId, metadata = {}) { this.placements.set(String(placementId), { id: String(placementId), itemId: String(itemId), ...structuredClone(metadata) }); this.eventBus?.emit("itemPlacement:changed", this.placementsSnapshot()); return this.placements.get(String(placementId)); }
  pickUp(placementId) { const placement = this.placements.get(String(placementId)); if (!placement) return null; this.placements.delete(String(placementId)); this.add(placement.itemId, 1); return placement; }
  placementsSnapshot() { return [...this.placements.values()].map((value) => structuredClone(value)); }
  snapshot() { return { ...super.snapshot(), inventory: this.inventorySnapshot(), placements: this.placementsSnapshot() }; }
  restore(snapshot = {}) { super.restore(snapshot); this.inventory = new Map(Object.entries(snapshot.inventory || {})); this.placements = new Map((snapshot.placements || []).map((p) => [String(p.id), structuredClone(p)])); }
}
export default ItemManager;
