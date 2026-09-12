import { eventBus } from "./EventBus.js";
import { scheduleData } from "./ScheduleData.js";
import { gameState } from "./GameState.js";

class ScheduleClockCoordinator {
  constructor() {
    this._unsubscribe = eventBus.on("time:changed", () => this._sync());
    this._syncing = false;
  }

  _sync() {
    if (this._syncing) return;
    this._syncing = true;
    try {
      scheduleData.advanceTo(gameState.day, gameState.clockMinutes);
    } finally {
      this._syncing = false;
    }
  }
}

export const scheduleClockCoordinator = new ScheduleClockCoordinator();
export default ScheduleClockCoordinator;
