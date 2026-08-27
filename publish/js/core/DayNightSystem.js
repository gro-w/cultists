import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";
import { endingManager } from "./EndingManager.js";
import { actionBudget } from "./ActionBudget.js";

/**
 * DayNightSystem - manages the day/night game-loop phase.
 * Every app (HIS, Social, ChatGTP, Notebook, Status, Settings) is always
 * available in both phases; HIS and Social instead vary their *content*
 * (patient/contact lists, dialogue) based on the current day + phase via
 * ScheduleData / `data/dayXXa.json` + `data/dayXXb.json` files.
 *
 * Emits `daynight:changed` whenever the phase toggles so the Desktop /
 * Taskbar / open app windows can react (e.g. re-render their content).
 * ActionBudget listens to this same event to start the new phase's action
 * budget, so this module only has to settle the ending phase's overage.
 */
class DayNightSystem {
  get phase() {
    return gameState.phase;
  }

  get day() {
    return gameState.day;
  }

  currentClockMinutes() {
    const phaseStart = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    return (phaseStart + actionBudget.phaseMinutes) % (24 * 60);
  }

  /** Visual daylight follows the wall clock, independently of duty status. */
  isDaylight() {
    const clockMinutes = this.currentClockMinutes();
    return clockMinutes >= 6 * 60 && clockMinutes < 18 * 60;
  }

  /** Roommates sleep from 22:40 through 07:40. */
  areRoommatesSleeping() {
    const clockMinutes = this.currentClockMinutes();
    return clockMinutes >= 22 * 60 + 40 || clockMinutes < 7 * 60 + 40;
  }

  areRoommatesWorking() {
    const clockMinutes = this.currentClockMinutes();
    return clockMinutes >= 8 * 60 && clockMinutes < 16 * 60;
  }

  areRoommatesAvailable() {
    return !this.areRoommatesSleeping() && !this.areRoommatesWorking();
  }

  /** All apps are always available; kept for backwards-compatible callers. */
  isAppAvailable() {
    return true;
  }

  /**
   * Toggle the phase (day -> night -> day, incrementing day count). If the
   * player is about to advance past the final authored night, resolve the
   * time-based ending instead of actually advancing (see `data/endings.json`
   * "finalConditions"/"defaultEndingId").
   *
   * Before advancing, the ENDING phase's action budget is settled
   * (`ActionBudget.settlePhase`): overspending during the day banks
   * "overtime debt" that shrinks tonight's budget, while overspending at
   * night directly costs 精神 (SAN) - the resulting `settlement` is
   * included in the `daynight:changed` payload so NotificationBanner can
   * tell the player what just happened.
   */
  toggle() {
    const clockMinutes = this.currentClockMinutes();
    const inWorkWindow = clockMinutes >= 8 * 60 && clockMinutes < 16 * 60;

    // Off duty during working hours: go to work without spending time.
    if (gameState.location === "dorm" && inWorkWindow) {
      gameState.location = "work";
      eventBus.emit("gamestate:changed", gameState.snapshot());
      eventBus.emit("daynight:changed", { phase: gameState.phase, day: gameState.day, location: gameState.location, phaseChanged: false });
      return gameState.phase;
    }

    if (gameState.location === "work") {
      // Outside working hours, going off duty does not spend time. At or
      // after 16:00, enter the night schedule so the next click sleeps.
      if (!inWorkWindow && gameState.phase === "night") {
        gameState.location = "dorm";
        eventBus.emit("gamestate:changed", gameState.snapshot());
        eventBus.emit("daynight:changed", { phase: gameState.phase, day: gameState.day, location: gameState.location, phaseChanged: false });
        return gameState.phase;
      }
      if (!inWorkWindow && gameState.phase === "day") {
        const settlement = actionBudget.settlePhase(gameState.phase);
        const elapsed = actionBudget.phaseMinutes;
        const phase = gameState.advancePhase({ incrementDay: false, location: "dorm" });
        const preservedMinutes = Math.max(0, 8 * 60 + elapsed - 16 * 60);
        eventBus.emit("daynight:changed", {
          phase,
          day: gameState.day,
          location: gameState.location,
          settlement,
          phaseChanged: true,
          phaseMinutes: preservedMinutes,
        });
        return phase;
      }
      if (!inWorkWindow) {
        gameState.location = "dorm";
        eventBus.emit("gamestate:changed", gameState.snapshot());
        eventBus.emit("daynight:changed", { phase: gameState.phase, day: gameState.day, location: gameState.location, phaseChanged: false });
        return gameState.phase;
      }

      // On duty in 08:00-16:00: end work and snap to exactly 16:00.
      actionBudget.phaseMinutes = 8 * 60;
      const settlement = actionBudget.settlePhase(gameState.phase);
      const phase = gameState.advancePhase({ incrementDay: true, location: "dorm" });
      eventBus.emit("daynight:changed", { phase, day: gameState.day, location: gameState.location, settlement });
      return phase;
    }

    // In the dorm outside working hours, sleep until next 08:00 and wake on duty.
    if (scheduleData.isFinalPhase(gameState.day, gameState.phase)) {
      actionBudget.settlePhase(gameState.phase);
      endingManager.resolveFinalEnding();
      return gameState.phase;
    }
    const settlement = actionBudget.settlePhase(gameState.phase);
    // Midnight already increments the date while actions advance the clock;
    // only sleep before midnight needs the night-to-day increment here.
    const incrementDay = clockMinutes >= 16 * 60;
    const phase = gameState.advancePhase({ incrementDay, location: "work" });
    eventBus.emit("daynight:changed", { phase, day: gameState.day, location: gameState.location, settlement });
    return phase;
  }
}

export const dayNightSystem = new DayNightSystem();
export default DayNightSystem;
