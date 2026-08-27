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
    if (scheduleData.isFinalPhase(gameState.day, gameState.phase)) {
      actionBudget.settlePhase(gameState.phase);
      endingManager.resolveFinalEnding();
      return gameState.phase;
    }
    const settlement = actionBudget.settlePhase(gameState.phase);
    const phase = gameState.advancePhase({
      incrementDay: !(gameState.phase === "night" && actionBudget.phaseMinutes >= 8 * 60),
    });
    eventBus.emit("daynight:changed", { phase, day: gameState.day, settlement });
    return phase;
  }
}

export const dayNightSystem = new DayNightSystem();
export default DayNightSystem;
