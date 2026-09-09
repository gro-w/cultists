import RuntimeRecordStore from "../../ng/core/RuntimeRecordStore.js";
export class SpellManager extends RuntimeRecordStore {
  constructor(options = {}) {
    super({ ...options, eventPrefix: "spell" });
    this.learned = new Set();
    this.definitions = new Map();
    this.gameState = options.gameState || null;
  }
  loadDefinitions(itemRecords = []) {
    for (const item of itemRecords) {
      (item.spells || []).forEach((spell, index) => {
        const id = String(spell.id || `${item.id}__${index}`);
        this.definitions.set(id, { ...structuredClone(spell), id, sourceBookId: item.id, sourceBookName: item.name, spellIndex: index });
      });
    }
    return this.definitions.size;
  }
  getDefinition(id) { return this.definitions.get(String(id)) || null; }
  allDefinitions() { return [...this.definitions.values()].map((value) => structuredClone(value)); }
  learn(id, spell = null) {
    const key = String(id);
    if (!this.definitions.has(key) && spell) this.definitions.set(key, structuredClone({ ...spell, id: key }));
    this.learned.add(key); this.eventBus?.emit("spell:learned", { id: key, spell: this.getDefinition(key) }); return true;
  }
  forget(id) { this.learned.delete(String(id)); return true; }
  isLearned(id) { return this.learned.has(String(id)); }
  cast(id, payload = {}) {
    const key = String(id);
    if (!this.isLearned(key)) return { ok: false, reason: "not-learned", spellId: key };
    const spell = this.getDefinition(key);
    const cost = Number(spell?.castSanCost ?? 5);
    if (this.gameState && Number(this.gameState.mental) < cost) return { ok: false, reason: "insufficient-san", spellId: key, cost };
    if (this.gameState) this.gameState.mental -= cost;
    const result = { ok: true, spellId: key, cost, spell, ...structuredClone(payload) };
    this.eventBus?.emit("spell:cast", result);
    return result;
  }
  snapshot() { return { ...super.snapshot(), learned: [...this.learned] }; }
  restore(snapshot = {}) { super.restore(snapshot); this.learned = new Set((snapshot.learned || []).map(String)); }
}
export default SpellManager;
