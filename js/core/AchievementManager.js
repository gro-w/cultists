import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { favorabilityManager, NPC_IDS } from "./FavorabilityManager.js";

const STORAGE_KEY = "cultists_achievements_v1";

/**
 * AchievementManager – data-driven achievement engine for 完蛋！我被邪教徒包围了！
 *
 * Architecture
 * ───────────
 * All achievement *definitions* live in `data/zh-hans/achievements.json`.
 * The manager loads those defs on `init()`, then subscribes to game events on
 * the shared EventBus (same bus used by EndingManager, ActionBudget, etc.).
 *
 * When an incoming event matches an achievement's trigger spec, `unlock(id)`
 * is called.  A single `achievement:unlocked` event is emitted so any
 * listener (AchievementToast, AchievementsApp, …) can react without coupling
 * to the manager directly.
 *
 * Persistence
 * ───────────
 * Achievement state (which IDs are unlocked, progress counters, and the
 * auxiliary tracking data like "has player ever had SAN < 30") is separate
 * from the URL-based game save so that achievements survive across multiple
 * playthroughs — they are stored in localStorage under STORAGE_KEY.
 *
 * A `reset()` method exists for debug / new-game scenarios; it is deliberately
 * NOT wired to the main new-game flow so that achievements act as permanent
 * cross-playthrough progress (consistent with the GPT design-doc intent).
 *
 * Event catalogue consumed by this module
 * ────────────────────────────────────────
 * Standard engine events (emitted by existing modules):
 *   gamestate:changed  { day, phase, mental, energy, physical, satiety }
 *   daynight:changed   { day, phase }
 *   ending:triggered   { id, title, … }
 *
 * New semantic game events (emitted by callers via emitGameEvent / directly):
 *   game:study          {}           – player chose to study during evening
 *   game:study_night    {}           – player forced to study 4 h at night
 *   game:exam_result    { score }    – Day-12 exam completed
 *   game:tabletop_session {}         – COC session participated in
 *   game:tabletop_skipped {}         – tabletop available but player studied
 *   game:skill_check    { skillId, roll, skillValue, outcome }
 *   game:sanity_changed { delta, value }  – MENTAL stat change (SAN = mental)
 *   game:text_read      { nodeId }   – a dialogue node was shown
 *   favorability:changed { npcId, value, previousValue, delta, allValues,
 *                          allHadPositive }
 */
class AchievementManager {
  constructor() {
    /** @type {Map<string, object>} id -> achievement definition */
    this.defs = new Map();
    /** @type {Map<string, { unlocked:boolean, unlockedAt:string|null, progress:number, seen:boolean }>} */
    this.state = new Map();
    /** @type {object} category id -> display label */
    this.categories = {};

    // Auxiliary tracking (not in the main state map, persisted alongside it)
    this._sanEverLow = false;   // has mental ever dropped below sanLowThreshold?
    this._readNodeIds = new Set();

    this._initPromise = null;
    this._unsubs = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialisation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load achievement definitions from data file and restore persisted state.
   * Idempotent and safe to call concurrently.
   */
  async init() {
    if (!this._initPromise) {
      this._initPromise = this._doInit();
    }
    return this._initPromise;
  }

  async _doInit() {
    const data = await dataLoader.loadJSON("achievements.json");
    this.categories = data.categories || {};

    (data.achievements || []).forEach((def) => {
      this.defs.set(def.id, def);
      // Initialise blank state for every known achievement
      if (!this.state.has(def.id)) {
        this.state.set(def.id, {
          unlocked: false,
          unlockedAt: null,
          progress: 0,
          seen: false,
        });
      }
    });

    this._loadFromStorage();
    this._subscribeEvents();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  isUnlocked(id) {
    return !!(this.state.get(id) && this.state.get(id).unlocked);
  }

  getAchievement(id) {
    return this.defs.get(id) || null;
  }

  getAllAchievements() {
    return [...this.defs.keys()].map((id) => ({
      def: this.defs.get(id),
      state: this.state.get(id),
    }));
  }

  getUnlockedAchievements() {
    return this.getAllAchievements().filter(({ state }) => state && state.unlocked);
  }

  getProgress(id) {
    const s = this.state.get(id);
    const d = this.defs.get(id);
    if (!s || !d) return null;
    return { progress: s.progress, target: d.trigger && d.trigger.target };
  }

  /** Mark an achievement as "seen" (notification read) and persist. */
  markSeen(id) {
    const s = this.state.get(id);
    if (s) {
      s.seen = true;
      this._saveToStorage();
    }
  }

  /** How many unlocked achievements haven't been acknowledged yet. */
  unseenCount() {
    let n = 0;
    this.state.forEach((s) => { if (s.unlocked && !s.seen) n++; });
    return n;
  }

  /** Unlock by id (idempotent – noop if already unlocked). */
  unlock(id) {
    const def = this.defs.get(id);
    const s = this.state.get(id);
    if (!def || !s || s.unlocked) return;
    s.unlocked = true;
    s.unlockedAt = new Date().toISOString();
    this._saveToStorage();
    eventBus.emit("achievement:unlocked", { def, state: s });
  }

  /** Debug / testing helper – wipe all persistent achievement state. */
  reset() {
    this.state.forEach((s) => {
      s.unlocked = false;
      s.unlockedAt = null;
      s.progress = 0;
      s.seen = false;
    });
    this._sanEverLow = false;
    this._readNodeIds = new Set();
    this._saveToStorage();
    eventBus.emit("achievements:reset", {});
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence (localStorage)
  // ─────────────────────────────────────────────────────────────────────────

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      (saved.achievements || []).forEach(({ id, unlocked, unlockedAt, progress, seen }) => {
        if (this.state.has(id)) {
          const s = this.state.get(id);
          s.unlocked = !!unlocked;
          s.unlockedAt = unlockedAt || null;
          s.progress = Number(progress) || 0;
          s.seen = !!seen;
        }
      });
      this._sanEverLow = !!saved.sanEverLow;
      this._readNodeIds = new Set(saved.readNodeIds || []);
    } catch (e) {
      console.warn("[AchievementManager] Failed to load from localStorage:", e);
    }
  }

  _saveToStorage() {
    try {
      const achievements = [...this.state.entries()].map(([id, s]) => ({
        id,
        unlocked: s.unlocked,
        unlockedAt: s.unlockedAt,
        progress: s.progress,
        seen: s.seen,
      }));
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          achievements,
          sanEverLow: this._sanEverLow,
          readNodeIds: [...this._readNodeIds],
        })
      );
    } catch (e) {
      console.warn("[AchievementManager] Failed to save to localStorage:", e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event subscriptions
  // ─────────────────────────────────────────────────────────────────────────

  _subscribeEvents() {
    // Remove any previously attached handlers (e.g. if init is re-called).
    this._unsubs.forEach((fn) => fn());
    this._unsubs = [];

    const on = (event, handler) => {
      this._unsubs.push(eventBus.on(event, handler));
    };

    // ── Standard engine events ────────────────────────────────────────────

    on("gamestate:changed", (snap) => {
      this._checkStateTriggers("gamestate:changed", snap);
    });

    on("daynight:changed", ({ day, phase }) => {
      this._checkStateTriggers("daynight:changed", { day, phase, ...gameState.snapshot() });
    });

    on("ending:triggered", (def) => {
      this._checkEventTriggers("ending:triggered", { id: def.id, ...def });
    });

    // ── Favorability ──────────────────────────────────────────────────────

    on("favorability:changed", (payload) => {
      this._handleFavorability(payload);
    });

    // ── New semantic game events ──────────────────────────────────────────

    on("game:study", () => {
      this._checkEventTriggers("game:study", {});
    });

    on("game:study_night", () => {
      this._checkEventTriggers("game:study_night", {});
    });

    on("game:exam_result", ({ score }) => {
      this._checkEventTriggers("game:exam_result", { score });
    });

    on("game:tabletop_session", () => {
      this._checkEventTriggers("game:tabletop_session", {});
    });

    on("game:tabletop_skipped", () => {
      this._checkEventTriggers("game:tabletop_skipped", {});
    });

    on("game:skill_check", (payload) => {
      this._checkEventTriggers("game:skill_check", payload);
    });

    on("game:sanity_changed", (payload) => {
      // Track whether SAN ever fell below the low threshold (for "触底反弹").
      const lowDef = this.defs.get("san_recovery");
      if (lowDef) {
        const threshold = lowDef.sanLowThreshold != null ? lowDef.sanLowThreshold : 30;
        if (payload.value <= threshold) this._sanEverLow = true;
      }
      this._checkEventTriggers("game:sanity_changed", payload);
    });

    on("game:text_read", ({ nodeId }) => {
      if (nodeId) this._readNodeIds.add(nodeId);
      // "all_texts_read" is evaluated here; see _checkEventTriggers.
      this._checkEventTriggers("game:text_read", { nodeId });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Trigger evaluation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check ALL achievements whose trigger.event matches `eventName` and whose
   * condition (if any) passes against `payload`.
   */
  _checkEventTriggers(eventName, payload) {
    this.defs.forEach((def) => {
      if (!def.trigger || def.trigger.event !== eventName) return;
      const s = this.state.get(def.id);
      if (!s) return;
      if (s.unlocked) return; // already done

      if (!this._evaluateCondition(def, payload)) return;

      if (def.trigger.progress) {
        // Progress-type: accumulate until target.
        const delta = this._resolveProgressDelta(def, payload);
        s.progress += delta;
        this._saveToStorage();
        if (s.progress >= (def.trigger.target || 1)) {
          this.unlock(def.id);
        }
      } else {
        // Simple once-or-every trigger.
        this.unlock(def.id);
      }
    });
  }

  /**
   * Check achievements that listen to gamestate/daynight changes (using
   * snapshot-style conditions like `{ mental: { lte: 0 } }`).
   */
  _checkStateTriggers(eventName, snap) {
    this.defs.forEach((def) => {
      if (!def.trigger || def.trigger.event !== eventName) return;
      const s = this.state.get(def.id);
      if (!s || s.unlocked) return;
      if (!this._evaluateCondition(def, snap)) return;
      this.unlock(def.id);
    });
  }

  /**
   * Handle all favourability-based achievements.  The payload from
   * FavorabilityManager includes allValues, allHadPositive, delta, value.
   */
  _handleFavorability(payload) {
    this.defs.forEach((def) => {
      if (!def.trigger || def.trigger.event !== "favorability:changed") return;
      const s = this.state.get(def.id);
      if (!s || s.unlocked) return;

      if (!this._evalFavCondition(def.trigger.condition, payload)) return;

      if (def.trigger.progress) {
        const delta = def.trigger.progressDelta === "delta_abs"
          ? Math.abs(payload.delta)
          : Math.max(0, payload.delta);
        s.progress += delta;
        this._saveToStorage();
        if (s.progress >= (def.trigger.target || 1)) {
          this.unlock(def.id);
        }
      } else {
        this.unlock(def.id);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Condition helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Generic condition evaluator for simple event payloads. */
  _evaluateCondition(def, payload) {
    const cond = def.trigger && def.trigger.condition;
    if (!cond) return true;

    // score-based (exam_result)
    if (cond.score != null) {
      if (!this._compareValue(payload.score, cond.score)) return false;
    }
    // outcome array (skill_check)
    if (cond.outcome) {
      if (!cond.outcome.includes(payload.outcome)) return false;
    }
    // delta threshold (sanity_changed)
    if (cond.delta != null) {
      if (!this._compareValue(payload.delta, cond.delta)) return false;
    }
    // absolute stat check (gamestate:changed)
    if (cond.mental != null) {
      if (!this._compareValue(payload.mental, cond.mental)) return false;
    }
    // SAN recovery: sanEverLow AND current value above target
    if (cond.hadLow != null) {
      if (!this._sanEverLow) return false;
    }
    if (cond.value != null) {
      if (!this._compareValue(payload.value, cond.value)) return false;
    }
    // daynight condition: day and mental
    if (cond.day != null) {
      if (!this._compareValue(payload.day, cond.day)) return false;
    }
    // allRead: check if we've read every dialogue node in the game
    if (cond.allRead != null) {
      if (!this._allTextsRead()) return false;
    }
    return true;
  }

  /** Condition evaluator for favourability events. */
  _evalFavCondition(cond, payload) {
    if (!cond) return true;
    if (cond.delta != null) {
      if (cond.delta.gt != null && !(payload.delta > cond.delta.gt)) return false;
      if (cond.delta.lt != null && !(payload.delta < cond.delta.lt)) return false;
    }
    if (cond.value != null) {
      if (cond.value.gte != null && !(payload.value >= cond.value.gte)) return false;
      if (cond.value.lte != null && !(payload.value <= cond.value.lte)) return false;
    }
    if (cond.allAbove != null) {
      const threshold = cond.allAbove;
      const all = payload.allValues || {};
      if (!NPC_IDS.every((id) => (all[id] || 0) >= threshold)) return false;
    }
    if (cond.allHadPositive != null) {
      if (!payload.allHadPositive) return false;
    }
    return true;
  }

  /** Compare a numeric value against a comparison-operator object or raw number. */
  _compareValue(actual, spec) {
    if (spec == null) return true;
    if (typeof spec === "number") return actual === spec;
    if (spec.gte != null && !(actual >= spec.gte)) return false;
    if (spec.gt != null && !(actual > spec.gt)) return false;
    if (spec.lte != null && !(actual <= spec.lte)) return false;
    if (spec.lt != null && !(actual < spec.lt)) return false;
    if (spec.eq != null && !(actual === spec.eq)) return false;
    return true;
  }

  /** Resolve how much to add to progress for a given event+def. */
  _resolveProgressDelta(def, payload) {
    // Most progress achievements count +1 per qualifying event.
    return 1;
  }

  /**
   * Check whether all dialogue nodes tracked in the game have been read.
   * "All nodes" means every node id that has ever been emitted via
   * `game:text_read`; we rely on ScheduleData having loaded all day files.
   * For now this compares against a separate `_totalNodeCount` which callers
   * can set via `setTotalNodeCount()`.
   */
  _allTextsRead() {
    if (!this._totalNodeCount || this._totalNodeCount <= 0) return false;
    return this._readNodeIds.size >= this._totalNodeCount;
  }

  /**
   * Called by main.js (or wherever ScheduleData finishes loading) to tell the
   * achievement manager the total number of unique dialogue nodes in the game,
   * so it can resolve the "all_texts_read" achievement.
   * @param {number} count
   */
  setTotalNodeCount(count) {
    this._totalNodeCount = count;
  }

  /** Subscribe to achievement-unlock events. Returns an unsubscribe fn. */
  onUnlocked(handler) {
    return eventBus.on("achievement:unlocked", handler);
  }
}

export const achievementManager = new AchievementManager();
export default AchievementManager;
