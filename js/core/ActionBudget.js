import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

const DEFAULT_LIMITS = { dialogueLimit: Infinity, inspectLimit: Infinity };

<<<<<<< HEAD
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
=======
function elapsedFromDayStart() {
  const clock = gameState.clockMinutes;
  return gameState.phase === "day" ? Math.max(0, clock - 8 * 60) : (clock >= 16 * 60 ? clock - 16 * 60 : clock + 8 * 60);
}

>>>>>>> origin/main
class ActionBudget {
  constructor() {
    this.config = null;
    this.used = { dialogue: 0, inspect: 0 };
    this.phaseMinutes = 0;
    this.sleepHistory = [];
    this.insufficientSleepStreak = 0;
    this.currentLimits = { ...DEFAULT_LIMITS };
    this._initPromise = null;
<<<<<<< HEAD

    eventBus.on("item:inspected", ({ inspectTimeAdvance } = {}) =>
      this.recordInspection(inspectTimeAdvance || 0));
    // Books with spells set skipTimeAdvance=true — time is charged when the
    // player confirms learning via SpellLearnDialog (spell:learned event).
    eventBus.on("item:used", ({ skipTimeAdvance, timeMinutes } = {}) => {
      if (!skipTimeAdvance) this.recordTimedAction(timeMinutes || 0);
    });
    eventBus.on("spell:learned", () => this.recordTimedAction(240));
=======
    eventBus.on("item:inspected", () => this.recordInspection());
    eventBus.on("item:used", () => this.recordTimedAction());
>>>>>>> origin/main
    eventBus.on("dialogue:turn", () => this.recordDialogueTurn());
    eventBus.on("gamestate:changed", () => this._syncClock());
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("action_budget.json").then((data) => {
        this.config = data;
        this.startPhase(gameState.phase);
      });
    }
    return this._initPromise;
  }

  startPhase(phase, preservedMinutes = null) {
    this.currentLimits = { ...DEFAULT_LIMITS };
    this.used = { dialogue: 0, inspect: 0 };
    this.phaseMinutes = preservedMinutes == null ? elapsedFromDayStart() : Math.max(0, Number(preservedMinutes) || 0);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  settlePhase(phase) {
    const phaseLimit = phase === "day"
      ? (this.config?.day?.workMinutes || 480)
      : (this.config?.night?.nightMinutes || 960);
    const minutesPerAction = this.config?.minutesPerAction || 20;
    const totalOverage = Math.max(0, Math.ceil((this.phaseMinutes - phaseLimit) / minutesPerAction));
    if (phase === "day") {
      return { totalOverage, kind: totalOverage ? "overtime" : null };
    }
    const sanLoss = totalOverage * (this.config?.sanLossPerLateNightAction || 0);
    if (sanLoss) gameState.applyMentalLoss(sanLoss, { recoverable: true });
    return { totalOverage, kind: totalOverage ? "allnighter" : null, sanLoss };
  }

  settleAtEight({ sleepMinutes = 0, day = gameState.day, phaseSettlement = null } = {}) {
    const safeSleepMinutes = Math.max(0, Number(sleepMinutes) || 0);
    const fullSleepMinutes = this.config?.fullSleepMinutes || 480;
    const recoveryMinutes = Math.min(safeSleepMinutes, fullSleepMinutes);
    const recoveredSan = safeSleepMinutes > 0
      ? gameState.recoverMental((recoveryMinutes / 60) * (this.config?.sanRecoveryPerSleepHour || 0))
      : 0;
    this.sleepHistory.push(safeSleepMinutes);
    this.sleepHistory = this.sleepHistory.slice(-3);
    const insufficient = safeSleepMinutes < (this.config?.insufficientSleepMinutes || 360);
    this.insufficientSleepStreak = insufficient ? this.insufficientSleepStreak + 1 : 0;
    let sleepDebtSanLoss = 0;
    if (this.insufficientSleepStreak >= 3) {
      sleepDebtSanLoss = this.config?.threeDaySleepDebtSanLoss || 0;
      if (sleepDebtSanLoss) gameState.modify({ mental: -sleepDebtSanLoss });
      this.insufficientSleepStreak = 0;
    }
    const medical = medicalCaseManager.settleDay(day - 1);
    const result = { day, sleepMinutes: safeSleepMinutes, recoveredSan, sleepDebtSanLoss, medical, phaseSettlement };
    eventBus.emit("day:settled", result);
    return result;
  }

  recordDialogueTurn() {
    this.used.dialogue += 1;
<<<<<<< HEAD
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
=======
    this._consumeTime();
  }

  recordInspection() {
    this.used.inspect += 1;
    this._consumeTime();
  }

  recordTimedAction() {
    this._consumeTime();
  }

  applyPenalty() {
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  remaining() {
>>>>>>> origin/main
    return Infinity;
  }

  _consumeTime() {
    const previousPhase = gameState.phase;
    const minutesPerAction = (this.config && this.config.minutesPerAction) || 20;
    const crossesEight = previousPhase === "night"
      && gameState.clockMinutes < 8 * 60
      && gameState.clockMinutes + minutesPerAction >= 8 * 60;
    const phaseSettlement = crossesEight ? this.settlePhase("night") : null;
    gameState.advanceClock(minutesPerAction);
    scheduleData.advanceTo(gameState.day, gameState.clockMinutes);
    if (previousPhase === "night" && gameState.phase === "day" && gameState.clockMinutes === 8 * 60) {
      this.settleAtEight({ day: gameState.day, sleepMinutes: 0, phaseSettlement });
    }
    this._syncClock();
    if (previousPhase !== gameState.phase) {
      eventBus.emit("daynight:changed", {
        day: gameState.day,
        phase: gameState.phase,
        duty: gameState.duty,
        location: gameState.location,
        phaseChanged: true,
        automatic: true,
      });
    }
  }

<<<<<<< HEAD
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
=======
  _syncClock() {
    this.phaseMinutes = elapsedFromDayStart();
    eventBus.emit("actionBudget:changed", this.snapshot());
>>>>>>> origin/main
  }

  restore(snapshot = {}) {
    this.used = {
      dialogue: Math.max(0, Number(snapshot.used?.dialogue) || 0),
      inspect: Math.max(0, Number(snapshot.used?.inspect) || 0),
    };
    this.currentLimits = { ...DEFAULT_LIMITS };
    this.phaseMinutes = elapsedFromDayStart();
    this.sleepHistory = Array.isArray(snapshot.sleepHistory) ? snapshot.sleepHistory.slice(-3) : [];
    this.insufficientSleepStreak = Math.max(0, Number(snapshot.insufficientSleepStreak) || 0);
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  snapshot() {
    return {
      used: { ...this.used },
      limits: { ...this.currentLimits },
      phaseMinutes: this.phaseMinutes,
      sleepHistory: [...this.sleepHistory],
      insufficientSleepStreak: this.insufficientSleepStreak,
    };
  }

  onChange(handler) {
    return eventBus.on("actionBudget:changed", handler);
  }
}

export const actionBudget = new ActionBudget();
export default ActionBudget;
