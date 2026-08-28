import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

const DEFAULT_LIMITS = { dialogueLimit: Infinity, inspectLimit: Infinity };

function elapsedFromDayStart() {
  const clock = gameState.clockMinutes;
  return gameState.phase === "day" ? Math.max(0, clock - 8 * 60) : (clock >= 16 * 60 ? clock - 16 * 60 : clock + 8 * 60);
}


class ActionBudget {
  constructor() {
    this.config = null;
    this.used = { dialogue: 0, inspect: 0 };
    this.phaseMinutes = 0;
    this.sleepHistory = [];
    this.insufficientSleepStreak = 0;
    this.currentLimits = { ...DEFAULT_LIMITS };
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
    this._consumeTime(0);
  }

  recordInspection(overrideMinutes = 0) {
    this.used.inspect += 1;
    this._consumeTime(overrideMinutes);
  }

  recordTimedAction(overrideMinutes = 0) {
    this._consumeTime(overrideMinutes);
  }

  applyPenalty() {
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  remaining() {
    return Infinity;
  }

  _consumeTime(overrideMinutes = 0) {
    const previousPhase = gameState.phase;
    const minutesPerAction = overrideMinutes > 0 ? overrideMinutes : (this.config && this.config.minutesPerAction) || 20;
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

  _syncClock() {
    this.phaseMinutes = elapsedFromDayStart();
    eventBus.emit("actionBudget:changed", this.snapshot());
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
