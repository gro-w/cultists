import RuntimeRecordStore from "./RuntimeRecordStore.js";
export class SpellManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "spell" }); this.learned = new Set(); }
  learn(id) { this.learned.add(String(id)); this.eventBus?.emit("spell:learned", { id: String(id) }); return true; }
  forget(id) { this.learned.delete(String(id)); return true; }
  isLearned(id) { return this.learned.has(String(id)); }
  snapshot() { return { ...super.snapshot(), learned: [...this.learned] }; }
  restore(snapshot = {}) { super.restore(snapshot); this.learned = new Set((snapshot.learned || []).map(String)); }
}
export default SpellManager;
