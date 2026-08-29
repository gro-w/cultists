import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";

/**
 * CGManager — manages full-screen CG background state.
 *
 * Data file: data/<lang>/cg.json
 *   { "cgs": [{ "id": string, "label": string, "imageData": string }] }
 *
 * EventBus events consumed:
 *   schedule:cg  { cgId, instanceId }
 *     - Emitted by ScheduleRunner when a showCg node executes.
 *     - cgId === ""  means end-CG (clear current CG).
 *
 * EventBus events emitted:
 *   cg:show  { cgId, imageData }
 *   cg:end   {}
 *
 * Snapshot/restore keys: { activeCgId: string|null }
 */
class CGManager {
  constructor() {
    /** @type {Map<string, {id:string, label:string, imageData:string}>} */
    this.defs = new Map();
    this._activeCgId = null;
    this._loadPromise = null;
    this._subscribed = false;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("cg.json").then((data) => {
        (data.cgs || []).forEach((cg) => this.defs.set(cg.id, cg));
      }).catch(() => { /* file may not exist yet */ });
    }
    return this._loadPromise;
  }

  /** Subscribe to EventBus after all modules are wired up. */
  mount() {
    if (this._subscribed) return;
    this._subscribed = true;
    // ScheduleRunner emits schedule:cg for showCg nodes.
    eventBus.on("schedule:cg", ({ cgId }) => {
      if (!cgId || cgId === "") {
        this.end();
      } else {
        this.show(cgId);
      }
    });
    // ScheduleRunner emits schedule:cg with cgId="" from endCg nodes.
    eventBus.on("schedule:end_cg", () => this.end());
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Show a CG by ID. Looks up the imageData and emits cg:show. */
  show(cgId) {
    const def = this.defs.get(String(cgId));
    if (!def) {
      console.warn(`[CGManager] Unknown CG id "${cgId}"`);
      return;
    }
    this._activeCgId = cgId;
    eventBus.emit("cg:show", { cgId, imageData: def.imageData || "", label: def.label || "" });
  }

  /** End the current CG. */
  end() {
    if (this._activeCgId === null) return;
    this._activeCgId = null;
    eventBus.emit("cg:end", {});
  }

  get activeCgId() {
    return this._activeCgId;
  }

  get isActive() {
    return this._activeCgId !== null;
  }

  /** Returns a copy of all CG definitions. */
  all() {
    return [...this.defs.values()];
  }

  getDef(cgId) {
    return this.defs.get(String(cgId)) || null;
  }

  // ── save/restore ───────────────────────────────────────────────────────────

  snapshot() {
    return { activeCgId: this._activeCgId };
  }

  restore(snap = {}) {
    const id = snap.activeCgId || null;
    this._activeCgId = null;
    if (id) this.show(id);
  }

  // ── dev-only helpers ───────────────────────────────────────────────────────

  /** Replace the in-memory definition list from raw JSON (used by DevCGEditorTab). */
  replaceData(data) {
    this.defs.clear();
    (data?.cgs || []).forEach((cg) => this.defs.set(cg.id, cg));
    dataLoader.clearCache("cg.json");
  }
}

export const cgManager = new CGManager();
export default CGManager;
