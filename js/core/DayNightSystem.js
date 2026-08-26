import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { windowManager } from "./WindowManager.js";

/**
 * DayNightSystem - manages the day/night game-loop phase.
 * - Day phase: HIS (medical system) app is available.
 * - Night phase: Social app is available.
 * ChatGTP / Notebook / StatusViewer remain available in both phases.
 *
 * Emits `daynight:changed` whenever the phase toggles so the Desktop /
 * Taskbar / apps can react (e.g. hide/show icons, close phase-locked apps).
 */
class DayNightSystem {
  constructor() {
    this.alwaysAvailableAppIds = ["chatgtp", "notebook", "status"];
  }

  get phase() {
    return gameState.phase;
  }

  get day() {
    return gameState.day;
  }

  isAppAvailable(appId) {
    if (this.alwaysAvailableAppIds.includes(appId)) return true;
    if (appId === "his") return this.phase === "day";
    if (appId === "social") return this.phase === "night";
    return true;
  }

  /** Toggle the phase (day -> night -> day, incrementing day count). */
  toggle() {
    const phase = gameState.advancePhase();
    this._closeUnavailableApps();
    eventBus.emit("daynight:changed", { phase, day: gameState.day });
    return phase;
  }

  _closeUnavailableApps() {
    const lockedOut =
      this.phase === "day" ? ["social"] : ["his"];
    lockedOut.forEach((appId) => windowManager.closeByAppId(appId));
  }
}

export const dayNightSystem = new DayNightSystem();
export default DayNightSystem;
