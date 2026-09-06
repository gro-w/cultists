import RuntimeRecordStore from "./RuntimeRecordStore.js";
export class NPCStateManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "npc" }); }
  adjustFavorability(npcId, delta) { const current = this.get(npcId) || { id: String(npcId), favorability: 0 }; return this.set(npcId, { ...current, favorability: Number(current.favorability || 0) + Number(delta || 0) }); }
}
export default NPCStateManager;
