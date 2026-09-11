import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

/**
 * The three core NPCs whose favourability is tracked throughout the game.
 * Order matches the binary save encoding (see SaveManager.js).
 */
export const NPC_IDS = ["ajie", "awei", "binbin"];

const FAV_MAX = 256;
const FAV_MIN = 0;

/**
 * FavorabilityManager – singleton tracking the three core roommates' (阿杰/
 * 阿伟/彬彬) favourability toward the protagonist.
 *
 * Favourability is mutated via `modify(npcId, delta)`, which emits
 * `favorability:changed` on the shared event bus.  The achievement system
 * (AchievementManager) and any UI subscriptions listen to that event.
 *
 * Wiring into dialogue:
 *   Blueprint state changes use the generic `setGlobal` node with the reserved
 *   favorability variable id and a delta input.
 *
 * Save / restore:
 *   `snapshot()` / `restore()` are called by SaveManager so favourability
 *   survives a URL-based save.
 */
class FavorabilityManager {
  constructor() {
    /** @type {Map<string, number>} npcId -> 0-256 value */
    this.values = new Map();
    /**
     * Set of npcIds that have had at least one positive delta this playthrough.
     * Used by the "雨露均沾" achievement (allHadPositive check).
     */
    this.hadPositive = new Set();
    this.npcs = [];
    this.indexById = new Map();
    this._loadPromise = null;
    eventBus.on("global-variable:changed", ({ id, previous, value }) => {
      if (id < 40 || id >= 60) return;
      const index = id - 40;
      const npcId = this.npcs[index]?.id || NPC_IDS[index];
      if (!npcId) return;
      this.values.set(npcId, value);
      const actualDelta = value - (typeof previous === "number" ? previous : value);
      if (actualDelta > 0) this.hadPositive.add(npcId);
      if (actualDelta !== 0) eventBus.emit("favorability:changed", {
        npcId, value, previousValue: previous, delta: actualDelta,
        allValues: this.getAll(), allHadPositive: NPC_IDS.every((id) => this.hadPositive.has(id)),
      });
    });
  }

  async load() {
    if (!this._loadPromise) this._loadPromise = Promise.all([globalVariableManager.init(), dataLoader.loadJSON("npcs.json")]).then(([, data]) => {
      this.npcs = data.npcs || [];
      this.npcs.forEach((npc) => {
        const numericId = Number(npc.numericid);
        if (!Number.isInteger(numericId) || numericId < 0 || numericId >= 20) return;
        this.indexById.set(npc.id, numericId);
        const value = globalVariableManager.get(40 + numericId);
        this.values.set(npc.id, value);
      });
    });
    return this._loadPromise;
  }

  /** Current favourability (0–256) for `npcId`. Unknown ids return 0. */
  get(npcId) {
    const index = this.indexById.get(npcId);
    return index === undefined ? 0 : globalVariableManager.get(40 + index);
  }

  /** Plain-object snapshot of all current values. */
  getAll() {
    return Object.fromEntries(this.values);
  }

  /**
   * Change `npcId`'s favourability by `delta` (positive or negative).
   * Clamps the result to [0, 256] and emits `favorability:changed`.
   *
   * Payload shape:
   *   { npcId, value, previousValue, delta, allValues, allHadPositive }
   */
  modify(npcId, delta) {
    if (!this.values.has(npcId) || !delta) return;
    const prev = this.get(npcId);
    const next = Math.max(FAV_MIN, Math.min(FAV_MAX, prev + delta));
    globalVariableManager.set(40 + this.indexById.get(npcId), next);
  }

  // -------------------------------------------------------------------
  // Save / restore (called by SaveManager)
  // -------------------------------------------------------------------

  snapshot() {
    return {
      values: this.getAll(),
      hadPositive: [...this.hadPositive],
    };
  }

  restore({ values = {}, hadPositive = [] } = {}, { useGlobalValues = false } = {}) {
    if (!useGlobalValues) [...this.values.keys()].forEach((id) => {
      if (typeof values[id] === "number") {
        const next = Math.max(FAV_MIN, Math.min(FAV_MAX, values[id]));
        this.values.set(id, next);
        const index = this.indexById.get(id);
        if (index !== undefined) globalVariableManager.set(40 + index, next, { emit: false });
      }
    });
    if (useGlobalValues) [...this.values.keys()].forEach((id) => {
      const index = this.indexById.get(id);
      if (index !== undefined) this.values.set(id, globalVariableManager.get(40 + index));
    });
    this.hadPositive = new Set(hadPositive.filter((id) => this.values.has(id)));
    // Notify listeners that state was restored (e.g. UI re-render).
    eventBus.emit("favorability:restored", { allValues: this.getAll() });
  }

  /** Subscribe to any favourability change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("favorability:changed", handler);
  }
}

export const favorabilityManager = new FavorabilityManager();
export default FavorabilityManager;
