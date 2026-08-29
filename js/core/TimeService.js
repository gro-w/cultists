import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

const ACTION_INTERVAL_MINUTES = 20;

function elapsedFromDayStart() {
  const clock = gameState.clockMinutes;
  return gameState.phase === "day"
    ? Math.max(0, clock - 8 * 60)
    : (clock >= 16 * 60 ? clock - 16 * 60 : clock + 8 * 60);
}

/**
 * The sole owner of ordinary in-game time progression and phase settlement.
 * Schedules describe effects; this service only advances the clock and runs
 * the existing day/night settlement boundary.
 */
class TimeService {
  constructor() {
    this.config = null;
    this.phaseMinutes = 0;
    this.sleepHistory = [];
    this.insufficientSleepStreak = 0;
    this._initPromise = null;
    eventBus.on("gamestate:changed", () => this._syncClock());
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("time_rules.json").then((data) => {
        this.config = data;
        this.startPhase(gameState.phase);
      });
    }
    return this._initPromise;
  }

  startPhase(phase, preservedMinutes = null) {
    this.phaseMinutes = preservedMinutes == null
      ? elapsedFromDayStart()
      : Math.max(0, Number(preservedMinutes) || 0);
    eventBus.emit("time:changed", this.snapshot());
  }

  advanceBy(minutes) {
    const amount = Number(minutes);
    if (!Number.isInteger(amount) || amount < 0 || amount % 20 !== 0) {
      throw new Error("Game time must be a non-negative multiple of 20 minutes");
    }
    if (amount === 0) return 0;
    const previousPhase = gameState.phase;
    const currentAbsoluteMinute = gameState.day * 1440 + gameState.clockMinutes;
    const finalAbsoluteMinute = currentAbsoluteMinute + amount;
    const maximumAbsoluteMinute = 7 * 1440 + 1439;
    if (finalAbsoluteMinute > maximumAbsoluteMinute) {
      throw new Error("Cannot advance time beyond the final game day");
    }
    const eightOClock = previousPhase === "night"
      ? (gameState.clockMinutes < 8 * 60
        ? gameState.day * 1440 + 8 * 60
        : (gameState.day + 1) * 1440 + 8 * 60)
      : null;
    const crossesEight = eightOClock != null && finalAbsoluteMinute >= eightOClock;
    const phaseSettlement = crossesEight
      ? (() => {
        this.phaseMinutes += eightOClock - currentAbsoluteMinute;
        return this.settlePhase("night");
      })()
      : null;
    gameState.advanceClock(amount);
    if (previousPhase === "day" && gameState.phase === "night" && gameState.duty === "on-duty") {
      gameState.setDuty("off-duty");
    }
    scheduleData.advanceTo(gameState.day, gameState.clockMinutes);
    if (crossesEight) this.settleAtEight({ day: Math.floor(eightOClock / 1440), sleepMinutes: 0, phaseSettlement });
    medicalCaseManager.processDue(gameState.day, gameState.clockMinutes).forEach((request) => {
      const result = scheduleData.enqueueMedicalIncident(request);
      if (result.ok) medicalCaseManager.submissions.get(request.submission.patientId).processed = true;
    });
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
    return amount;
  }

  /** Move to a system boundary such as sleep/wake; not a narrative schedule. */
  advanceTo(day, minutes, { sleepMinutes = 0, automatic = false } = {}) {
    const previousPhase = gameState.phase;
    if (minutes === 8 * 60 && Number(day) > gameState.day) {
      medicalCaseManager.processDue(Number(day), minutes).forEach((request) => {
        const result = scheduleData.enqueueMedicalIncident(request);
        if (result.ok) medicalCaseManager.submissions.get(request.submission.patientId).processed = true;
      });
      const phaseSettlement = this.settlePhase("night");
      this.settleAtEight({ day: Number(day), sleepMinutes, phaseSettlement });
    }
    gameState.setClock(day, minutes);
    scheduleData.advanceTo(gameState.day, gameState.clockMinutes);
    medicalCaseManager.processDue(gameState.day, gameState.clockMinutes).forEach((request) => {
      const result = scheduleData.enqueueMedicalIncident(request);
      if (result.ok) medicalCaseManager.submissions.get(request.submission.patientId).processed = true;
    });
    this._syncClock();
    if (previousPhase !== gameState.phase) {
      eventBus.emit("daynight:changed", {
        day: gameState.day, phase: gameState.phase, duty: gameState.duty,
        location: gameState.location, phaseChanged: true, automatic,
      });
    }
  }

  // DEV-TOOLS:START
  /**
   * Developer-only direct clock adjustment. The developer UI must use this
   * entry point instead of mutating GameState or phase counters itself.
   */
  debugSetTime(day, minutes, location = gameState.location) {
    const targetDay = Number(day);
    const targetMinutes = Number(minutes);
    if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 7
      || !Number.isInteger(targetMinutes) || targetMinutes < 0 || targetMinutes >= 1440) {
      throw new Error("Invalid developer game time");
    }
    const phase = targetMinutes >= 8 * 60 && targetMinutes < 16 * 60 ? "day" : "night";
    gameState.restore({ day: targetDay, phase, location });
    this.startPhase(phase, phase === "day"
      ? Math.max(0, targetMinutes - 8 * 60)
      : (targetMinutes >= 16 * 60 ? targetMinutes - 16 * 60 : targetMinutes + 8 * 60));
    scheduleData.advanceTo(targetDay, targetMinutes);
    eventBus.emit("daynight:changed", {
      day: targetDay,
      phase,
      duty: gameState.duty,
      location: gameState.location,
      phaseChanged: false,
      developer: true,
    });
    return { day: targetDay, minutes: targetMinutes, phase };
  }
  // DEV-TOOLS:END

  settlePhase(phase) {
    const phaseLimit = phase === "day"
      ? (this.config?.day?.workMinutes || 480)
      : (this.config?.night?.nightMinutes || 960);
    const totalOverage = Math.max(0, Math.ceil((this.phaseMinutes - phaseLimit) / ACTION_INTERVAL_MINUTES));
    if (phase === "day") return { totalOverage, kind: totalOverage ? "overtime" : null };
    const sanLoss = totalOverage * (this.config?.sanLossPerLateNightAction || 0);
    if (sanLoss) gameState.applyMentalLoss(sanLoss, { recoverable: true });
    return { totalOverage, kind: totalOverage ? "allnighter" : null, sanLoss };
  }

  settleAtEight({ sleepMinutes = 0, day = gameState.day, phaseSettlement = null } = {}) {
    const safeSleepMinutes = Math.max(0, Number(sleepMinutes) || 0);
    const recoveryMinutes = Math.min(safeSleepMinutes, this.config?.fullSleepMinutes || 480);
    const recoveredSan = safeSleepMinutes > 0
      ? gameState.recoverMental((recoveryMinutes / 60) * (this.config?.sanRecoveryPerSleepHour || 0)) : 0;
    this.sleepHistory.push(safeSleepMinutes);
    this.sleepHistory = this.sleepHistory.slice(-3);
    const insufficient = safeSleepMinutes < (this.config?.insufficientSleepMinutes || 360);
    this.insufficientSleepStreak = insufficient ? this.insufficientSleepStreak + 1 : 0;
    let sleepDebtSanLoss = 0;
    if (this.insufficientSleepStreak >= 3) {
      sleepDebtSanLoss = this.config?.threeDaySleepDebtSanLoss || 0;
      if (sleepDebtSanLoss) gameState.modify({ sanity: -sleepDebtSanLoss });
      this.insufficientSleepStreak = 0;
    }
    const medical = medicalCaseManager.settleDay(day - 1);
    const result = { day, sleepMinutes: safeSleepMinutes, recoveredSan, sleepDebtSanLoss, medical, phaseSettlement };
    eventBus.emit("day:settled", result);
    return result;
  }

  snapshot() {
    return {
      phaseMinutes: this.phaseMinutes,
      sleepHistory: [...this.sleepHistory],
      insufficientSleepStreak: this.insufficientSleepStreak,
    };
  }

  restore(snapshot = {}) {
    const savedPhaseMinutes = Number(snapshot.phaseMinutes);
    this.phaseMinutes = Number.isFinite(savedPhaseMinutes) && savedPhaseMinutes >= 0
      ? savedPhaseMinutes
      : elapsedFromDayStart();
    this.sleepHistory = Array.isArray(snapshot.sleepHistory) ? snapshot.sleepHistory.slice(-3) : [];
    this.insufficientSleepStreak = Math.max(0, Number(snapshot.insufficientSleepStreak) || 0);
    eventBus.emit("time:changed", this.snapshot());
  }

  _syncClock() {
    this.phaseMinutes = elapsedFromDayStart();
    eventBus.emit("time:changed", this.snapshot());
  }

  onChange(handler) { return eventBus.on("time:changed", handler); }
}

export const timeService = new TimeService();
export default TimeService;
