import RuntimeRecordStore from "../../core/RuntimeRecordStore.js";
export class OutcomeManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "outcome" }); }
  unlock(id, payload = {}) { const value = this.set(id, { unlocked: true, ...payload }); this.eventBus?.emit("outcome:unlocked", value); return value; }
}
export default OutcomeManager;
