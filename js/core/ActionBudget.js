import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";

const DEFAULT_LIMITS = { dialogueLimit: Infinity, inspectLimit: Infinity };

/**
 * ActionBudget - singleton tracking how many "actions" (NPC dialogue turns,
 * item inspections) the player has spent in the current day/night phase,
 * and applying the configured consequence once a phase ends over budget:
 *   - overspending during the DAY is banked as overtime debt that shrinks
 *     the *upcoming night's* budget (加班侵占夜间时间);
 *   - overspending at NIGHT directly costs 精神 (SAN) once the night ends
 *     (熬夜熬过头掉 san).
 * Limits are data-driven via `data/action_budget.json`.
 *
 * Wiring: `recordDialogueTurn()`/`recordInspection()` are driven by the
 * `dialogue:turn` (emitted by HIS/Social/Monitor when the player picks a
 * dialogue option) and `item:inspected` (emitted by ItemManager.inspect())
 * events, so this module stays decoupled from the apps/managers that
 * generate those actions - same one-way event-bus pattern EndingManager
 * uses for `item:used`.
 *
 * Time tracking:
 *   - Dialogue turns: fixed minutesPerAction (data-driven, default 20 min).
 *   - Item inspections: use item-level `inspectTimeAdvance` when set,
 *     otherwise fall back to minutesPerAction.
 *   - Item use (non-book): use `timeMinutes` from the event (useEffect value).
 *   - Book spell-learning: ActionBudget listens to `spell:learned` and charges
 *     the fixed 240-minute (4 h) learning cost directly.
 */
class ActionBudget {
  constructor() {
    this.config = null;
    this.used = { dialogue: 0, inspect: 0 };
    this.phaseMinutes = 0;
    this.sleepHistory = [];
    this.insufficientSleepStreak = 0;
    this.currentLimits = { ...DEFAULT_LIMITS };
    this._pendingNightDebt = 0;
    this._initPromise = null;

    eventBus.on("item:inspected", ({ inspectTimeAdvance } = {}) =>
      this.recordInspection(inspectTimeAdvance || 0));
    // Books with spells set skipTimeAdvance=true — time is charged when the
    // player confirms learning via SpellLearnDialog (spell:learned event).
    eventBus.on("item:used", ({ skipTimeAdvance, timeMinutes } = {}) => {
      if (!skipTimeAdvance) this.recordTimedAction(timeMinutes || 0);
    });
    eventBus.on("spell:learned", () => this.recordTimedAction(240));
    eventBus.on("dialogue:turn", () => this.recordDialogueTurn());
    // DayNightSystem.toggle() settles the ending phase's overage and then
    // emits this same event with the new phase - listening here (rather
    // than DayNightSystem calling startPhase directly) means GameState's
    // own daynight:changed emission (e.g. from SaveManager restoring a
    // save) also correctly resets the budget for whatever phase was
    // loaded, with a single code path.
    eventBus.on("daynight:changed", ({ phase, phaseChanged = true, phaseMinutes }) => {
      if (phaseChanged) this.startPhase(phase, phaseMinutes);
    });
  }

  /**
   * Load `data/action_budget.json` (idempotent, safe to call concurrently)
   * and activate the CURRENT phase's limits immediately - `startPhase()`
   * is otherwise only driven by the `daynight:changed` event, which does
   * not fire at boot, so without this the very first day/night would sit
   * at the Infinity default until the first phase toggle.
   */
  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("action_budget.json").then((data) => {
        this.config = data;
        this.startPhase(gameState.phase);
      });
    }
    return this._initPromise;
  }

  /**
   * Activate the limits for `phase`, applying any overtime debt carried
   * over from the day that just ended (only relevant when phase="night")
   * and resetting the used-action counters for the new phase.
   */
  startPhase(phase, preservedMinutes = 0) {
    // Action count is intentionally unlimited. Time consumed by each action
    // is the only action constraint; phase limits remain for overtime/sleep
    // consequences, not for blocking or rationing actions.
    this.currentLimits = { ...DEFAULT_LIMITS };
    this._pendingNightDebt = 0;
    this.used = { dialogue: 0, inspect: 0 };
    this.phaseMinutes = Math.max(0, Number(preservedMinutes) || 0);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Tally the (about-to-end) `phase`'s overage against its limits and
   * apply the matching consequence.
   * @returns {{ totalOverage: number, kind: "overtime"|"allnighter"|null, debt?: number, sanLoss?: number }}
   */
  settlePhase(phase) {
    const phaseLimit = phase === "day"
      ? (this.config && this.config.day.workMinutes) || 480
      : (this.config && this.config.night.nightMinutes) || 960;
    const minutesPerAction = (this.config && this.config.minutesPerAction) || 20;
    const timeOverage = Math.max(0, Math.ceil((this.phaseMinutes - phaseLimit) / minutesPerAction));
    const totalOverage = timeOverage;
    if (phase === "day" && totalOverage <= 0) return { totalOverage: 0, kind: null };

    const perAction = (this.config && this.config.overtimePenaltyPerAction) || 1;
    if (phase === "day") {
      this._pendingNightDebt += totalOverage * perAction;
      return { totalOverage, kind: "overtime", debt: this._pendingNightDebt };
    }

    const sanLossPerAction = (this.config && this.config.sanLossPerLateNightAction) || 0;
    const sanLoss = totalOverage * sanLossPerAction;
    if (sanLoss > 0) gameState.applyMentalLoss(sanLoss, { recoverable: true });
    const nightMinutes = (this.config && this.config.night.nightMinutes) || 960;
    const sleepMinutes = Math.max(0, nightMinutes - this.phaseMinutes);
    const recoveryPerHour = (this.config && this.config.sanRecoveryPerSleepHour) || 0;
    const recoveredSan = gameState.recoverMental((sleepMinutes / 60) * recoveryPerHour);
    const insufficientThreshold = (this.config && this.config.insufficientSleepMinutes) || nightMinutes;
    const insufficient = sleepMinutes < insufficientThreshold;
    this.sleepHistory.push(sleepMinutes);
    this.sleepHistory = this.sleepHistory.slice(-3);
    this.insufficientSleepStreak = insufficient ? this.insufficientSleepStreak + 1 : 0;
    let sleepDebtSanLoss = 0;
    if (this.insufficientSleepStreak >= 3) {
      sleepDebtSanLoss = (this.config && this.config.threeDaySleepDebtSanLoss) || 0;
      if (sleepDebtSanLoss > 0) gameState.modify({ mental: -sleepDebtSanLoss });
      this.insufficientSleepStreak = 0;
    }
    return {
      totalOverage,
      kind: totalOverage > 0 ? "allnighter" : null,
      sanLoss,
      sleepMinutes,
      recoveredSan,
      sleepDebtSanLoss,
    };
  }

  recordDialogueTurn() {
    this.used.dialogue += 1;
    this._consumeTime(0);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Record one item inspection.
   * @param {number} [overrideMinutes]  Use item's inspectTimeAdvance when > 0.
   */
  recordInspection(overrideMinutes = 0) {
    this.used.inspect += 1;
    this._consumeTime(overrideMinutes);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Record a timed action that is not a dialogue turn or inspection
   * (item use, spell learning, etc.).
   * @param {number} [overrideMinutes]  Exact time cost; falls back to minutesPerAction.
   */
  recordTimedAction(overrideMinutes = 0) {
    this._consumeTime(overrideMinutes);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Permanently shrink the CURRENT phase's remaining budget (compatibility
   * no-op — action count limits were removed; kept so old NPC data doesn't
   * throw).
   * @param {{dialogueLimit?: number, inspectLimit?: number}} penalty
   */
  applyPenalty(penalty = {}) {
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /** Compatibility API: action counts are unlimited. */
  remaining(kind) {
    return Infinity;
  }

  snapshot() {
    return {
      used: { ...this.used },
      limits: { ...this.currentLimits },
      pendingNightDebt: this._pendingNightDebt,
      phaseMinutes: this.phaseMinutes,
      sleepHistory: [...this.sleepHistory],
      insufficientSleepStreak: this.insufficientSleepStreak,
    };
  }

  /**
   * Advance the phase clock.
   * @param {number} [overrideMinutes]  If > 0, use this exact value instead of minutesPerAction.
   */
  _consumeTime(overrideMinutes = 0) {
    const minutesPerAction = overrideMinutes > 0
      ? overrideMinutes
      : (this.config && this.config.minutesPerAction) || 20;
    const previousMinutes = this.phaseMinutes;
    this.phaseMinutes += minutesPerAction;
    const phaseStart = gameState.phase === "night" ? 16 * 60 : 8 * 60;
    const previousClock = phaseStart + previousMinutes;
    const nextClock = phaseStart + this.phaseMinutes;
    if (Math.floor(nextClock / (24 * 60)) > Math.floor(previousClock / (24 * 60))) {
      gameState.advanceDayAtMidnight();
    }
    // The schedule phase is clock-driven, not duty-driven. Crossing 16:00
    // enters the night slot even during overtime, and crossing the next
    // 08:00 enters the following day's day slot even if the player stayed in
    // the dorm instead of clicking the bed. Preserve any minutes beyond the
    // boundary so the displayed clock remains continuous.
    if (gameState.phase === "day" && this.phaseMinutes >= 8 * 60) {
      const settlement = this.settlePhase(gameState.phase);
      const preservedMinutes = this.phaseMinutes - 8 * 60;
      const phase = gameState.advancePhase({ incrementDay: false, location: gameState.location });
      this.phaseMinutes = preservedMinutes;
      eventBus.emit("daynight:changed", {
        phase,
        day: gameState.day,
        location: gameState.location,
        settlement,
        phaseChanged: true,
        phaseMinutes: preservedMinutes,
        automatic: true,
      });
    }
    if (gameState.phase === "night" && this.phaseMinutes >= 16 * 60) {
      const phase = gameState.advancePhase({ incrementDay: false, location: gameState.location });
      const preservedMinutes = this.phaseMinutes - 16 * 60;
      this.phaseMinutes = preservedMinutes;
      eventBus.emit("daynight:changed", {
        phase,
        day: gameState.day,
        location: gameState.location,
        phaseChanged: true,
        phaseMinutes: preservedMinutes,
        automatic: true,
      });
    }
  }

  restore(snapshot = {}) {
    this.used = {
      dialogue: Math.max(0, Number(snapshot.used?.dialogue) || 0),
      inspect: Math.max(0, Number(snapshot.used?.inspect) || 0),
    };
    this.currentLimits = { ...DEFAULT_LIMITS };
    this._pendingNightDebt = 0;
    this.phaseMinutes = Math.max(0, Number(snapshot.phaseMinutes) || 0);
    this.sleepHistory = Array.isArray(snapshot.sleepHistory) ? snapshot.sleepHistory.slice(-3) : [];
    this.insufficientSleepStreak = Math.max(0, Number(snapshot.insufficientSleepStreak) || 0);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /** Subscribe to any change in used actions / limits. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("actionBudget:changed", handler);
  }
}

export const actionBudget = new ActionBudget();
export default ActionBudget;
