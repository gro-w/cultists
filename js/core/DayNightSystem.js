import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { calendarData } from "./CalendarData.js";
import { scheduleData } from "./ScheduleData.js";
import { endingManager } from "./EndingManager.js";
import { timeService } from "./TimeService.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

class DayNightSystem {
  get phase() { return gameState.phase; }
  get day() { return gameState.day; }

  currentClockMinutes() { return gameState.clockMinutes; }
  isDaylight() { return this.currentClockMinutes() >= 6 * 60 && this.currentClockMinutes() < 18 * 60; }
  areRoommatesSleeping() {
    const clock = this.currentClockMinutes();
    return clock >= 22 * 60 + 40 || clock < 7 * 60 + 40;
  }
  areRoommatesWorking() {
    const clock = this.currentClockMinutes();
    return !this.isRestDay() && clock >= 8 * 60 && clock < 16 * 60;
  }
  areRoommatesAvailable() { return !this.areRoommatesSleeping() && !this.areRoommatesWorking(); }
  isRestDay(day = gameState.day) { return calendarData.isRestDay(day); }
  isAppAvailable() { return true; }

  _emitChanged(previousPhase, automatic = false) {
    eventBus.emit("daynight:changed", {
      day: gameState.day,
      phase: gameState.phase,
      duty: gameState.duty,
      location: gameState.location,
      phaseChanged: previousPhase !== gameState.phase,
      automatic,
    });
  }

  _setTime(day, minutes, automatic = false, sleepMinutes = 0) {
    timeService.advanceTo(day, minutes, { automatic, sleepMinutes });
  }

  _setDuty(duty) {
    gameState.setDuty(duty);
    this._emitChanged(gameState.phase, false);
  }

  _nextEightOClock() {
    return gameState.clockMinutes < 8 * 60
      ? { day: gameState.day, minutes: 8 * 60 }
      : { day: gameState.day + 1, minutes: 8 * 60 };
  }

  toggle() {
    const clock = this.currentClockMinutes();
    const inWorkWindow = clock >= 8 * 60 && clock < 16 * 60;
    const restToday = this.isRestDay();
    const previousPhase = gameState.phase;

    if (gameState.duty === "on-duty") {
      if (!restToday && inWorkWindow) {
        if (scheduleData.hasPendingBatch("work", gameState.day, 8 * 60)) {
          return { ok: false, reason: "unfinishedWork", batch: "a" };
        }
        this._setTime(gameState.day, 16 * 60);
      }
      gameState.setDuty("off-duty");
      this._emitChanged(previousPhase);
      return gameState.phase;
    }

    if (inWorkWindow) {
      if (restToday) {
        this._setTime(gameState.day, 16 * 60);
        gameState.setDuty("off-duty");
        this._emitChanged(previousPhase);
      } else {
        gameState.setDuty("on-duty");
        this._emitChanged(previousPhase);
      }
      return gameState.phase;
    }

    const target = this._nextEightOClock();
    const targetIsRest = this.isRestDay(target.day);
    if (scheduleData.hasPendingBatch("work", gameState.day, 16 * 60)) {
      return { ok: false, reason: "unfinishedWork", batch: "b" };
    }
    if (scheduleData.isFinalPhase(gameState.day, gameState.phase) && !targetIsRest) {
      endingManager.resolveFinalEnding();
      return gameState.phase;
    }
    const sleepMinutes = target.day === gameState.day
      ? target.minutes - gameState.clockMinutes
      : (1440 - gameState.clockMinutes) + target.minutes;
    this._setTime(target.day, target.minutes, true, sleepMinutes);
    gameState.setDuty(targetIsRest ? "off-duty" : "on-duty");
    this._emitChanged(previousPhase, true);

    return gameState.phase;
  }
}

export const dayNightSystem = new DayNightSystem();
export default DayNightSystem;
