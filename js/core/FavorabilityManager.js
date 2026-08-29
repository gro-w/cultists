import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";

/**
 * The three core NPCs whose favourability is tracked throughout the game.
 * Order matches the binary save encoding (see SaveManager.js).
 */
export const NPC_IDS = ["ajie", "awei", "binbin"];

/**
 * Initial favourability values from the game design (day1 Twee passage):
 *   阿杰好感度：60 / 阿伟好感度：50 / 彬彬好感度：40
 */
const INITIAL_VALUES = { ajie: 60, awei: 50, binbin: 40 };

const FAV_MAX = 100;
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
 *   schedule blueprint's `favorabilityOperation` node with `npcId` and `delta`
 *   is applied by the `ScheduleRunner`.
 *
 * Save / restore:
 *   `snapshot()` / `restore()` are called by SaveManager so favourability
 *   survives a URL-based save.
 */
class FavorabilityManager {
  constructor() {
    /** @type {Map<string, number>} npcId -> 0-100 value */
    this.values = new Map(Object.entries(INITIAL_VALUES));
    /**
     * Set of npcIds that have had at least one positive delta this playthrough.
     * Used by the "雨露均沾" achievement (allHadPositive check).
     */
    this.hadPositive = new Set();
    this.npcs = [];
    this._loadPromise = null;
  }

  async load() {
    if (!this._loadPromise) this._loadPromise = dataLoader.loadJSON("npcs.json").then((data) => {
      this.npcs = data.npcs || [];
      this.npcs.forEach((npc) => {
        const initialFavorability = Number(npc.initialFavorability);
        if (Number.isFinite(initialFavorability)) this.values.set(npc.id, Math.max(FAV_MIN, Math.min(FAV_MAX, initialFavorability)));
      });
    });
    return this._loadPromise;
  }

  /** Current favourability (0–100) for `npcId`. Unknown ids return 0. */
  get(npcId) {
    return this.values.has(npcId) ? this.values.get(npcId) : 0;
  }

  /** Plain-object snapshot of all current values. */
  getAll() {
    return Object.fromEntries(this.values);
  }

  /**
   * Change `npcId`'s favourability by `delta` (positive or negative).
   * Clamps the result to [0, 100] and emits `favorability:changed`.
   *
   * Payload shape:
   *   { npcId, value, previousValue, delta, allValues, allHadPositive }
   */
  modify(npcId, delta) {
    if (!this.values.has(npcId) || !delta) return;
    const prev = this.get(npcId);
    const next = Math.max(FAV_MIN, Math.min(FAV_MAX, prev + delta));
    const actualDelta = next - prev;
    this.values.set(npcId, next);
    if (actualDelta > 0) this.hadPositive.add(npcId);

    eventBus.emit("favorability:changed", {
      npcId,
      value: next,
      previousValue: prev,
      delta: actualDelta,
      allValues: this.getAll(),
      allHadPositive: NPC_IDS.every((id) => this.hadPositive.has(id)),
    });
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

  restore({ values = {}, hadPositive = [] } = {}) {
    [...this.values.keys()].forEach((id) => {
      if (typeof values[id] === "number") {
        this.values.set(id, Math.max(FAV_MIN, Math.min(FAV_MAX, values[id])));
      }
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
