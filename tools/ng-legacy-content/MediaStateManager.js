import RuntimeRecordStore from "../../ng/core/RuntimeRecordStore.js";
export class MediaStateManager extends RuntimeRecordStore {
  constructor(options = {}) { super({ ...options, eventPrefix: "media" }); }
  unlock(id, value = true) { return this.set(id, { unlocked: Boolean(value) }); }
  play(id, payload = {}) { this.eventBus?.emit("media:play", { id: String(id), ...payload }); return this.get(id); }
  playBgm(id, payload = {}) { return this.play(id, { kind: "bgm", ...payload }); }
  showCg(id, payload = {}) { const value = this.unlock(id, true); this.eventBus?.emit("media:cg", { id: String(id), ...payload }); return value; }
  stopBgm() { this.eventBus?.emit("media:stop-bgm", {}); }
}
export default MediaStateManager;
