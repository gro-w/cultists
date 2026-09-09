import RuntimeRecordStore from "../../ng/core/RuntimeRecordStore.js";
export class SelectionSubmissionManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "selection" }); this.selections = new Map(); }
  select(sessionId, optionId) { this.selections.set(String(sessionId), String(optionId)); this.eventBus?.emit("selection:selected", { sessionId: String(sessionId), optionId: String(optionId) }); return optionId; }
  submit(sessionId, payload = {}) { const id = String(sessionId); const result = this.set(id, { selected: this.selections.get(id) ?? null, submitted: true, ...payload }); this.eventBus?.emit("selection:submitted", result); return result; }
  snapshot() { return { ...super.snapshot(), selections: Object.fromEntries(this.selections) }; }
  restore(snapshot = {}) { super.restore(snapshot); this.selections = new Map(Object.entries(snapshot.selections || {})); }
}
export default SelectionSubmissionManager;
