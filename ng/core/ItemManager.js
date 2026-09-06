import RuntimeRecordStore from "./RuntimeRecordStore.js";

export class ItemManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "item" }); this.inventory = new Map(); this.placements = new Map(); }
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
