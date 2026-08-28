import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";

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
    eventBus.on("item:inspected", () => this.recordInspection());
    eventBus.on("item:used", () => this.recordTimedAction());
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
    const limit = phase === "day" ? 480 : 960;
    const overage = Math.max(0, Math.ceil((this.phaseMinutes - limit) / 20));
    return { totalOverage: overage, kind: overage ? (phase === "day" ? "overtime" : "allnighter") : null };
  }

  recordDialogueTurn() {
    this.used.dialogue += 1;
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
    return Infinity;
  }

  _consumeTime() {
    const previousPhase = gameState.phase;
    gameState.advanceClock((this.config && this.config.minutesPerAction) || 20);
    scheduleData.advanceTo(gameState.day, gameState.clockMinutes);
    this._syncClock();
    if (previousPhase !== gameState.phase) {
      eventBus.emit("daynight:changed", {
        day: gameState.day,
        phase: gameState.phase,
        duty: gameState.duty,
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
