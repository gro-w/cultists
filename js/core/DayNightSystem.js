import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { scheduleData } from "./ScheduleData.js";
import { endingManager } from "./EndingManager.js";

/**
 * DayNightSystem - manages the day/night game-loop phase.
 * Every app (HIS, Social, ChatGTP, Notebook, Status, Settings) is always
 * available in both phases; HIS and Social instead vary their *content*
 * (patient/contact lists, dialogue) based on the current day + phase via
 * ScheduleData / `data/dayXXa.json` + `data/dayXXb.json` files.
 *
 * Emits `daynight:changed` whenever the phase toggles so the Desktop /
 * Taskbar / open app windows can react (e.g. re-render their content).
 */
class DayNightSystem {
  get phase() {
    return gameState.phase;
  }

  get day() {
    return gameState.day;
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
   */
  toggle() {
    if (scheduleData.isFinalPhase(gameState.day, gameState.phase)) {
      endingManager.resolveFinalEnding();
      return gameState.phase;
    }
    const phase = gameState.advancePhase();
    eventBus.emit("daynight:changed", { phase, day: gameState.day });
    return phase;
  }
}

export const dayNightSystem = new DayNightSystem();
export default DayNightSystem;
