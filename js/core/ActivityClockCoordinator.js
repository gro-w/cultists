import { eventBus } from "./EventBus.js";
import { activityData } from "./ActivityData.js";
import { gameState } from "./GameState.js";

class ActivityClockCoordinator {
  constructor() {
    this._unsubscribe = eventBus.on("time:changed", () => this._sync());
    this._syncing = false;
  }

  _sync() {
    if (this._syncing) return;
    this._syncing = true;
    try {
      activityData.advanceTo(gameState.day, gameState.clockMinutes);
    } finally {
      this._syncing = false;
    }
  }
}

export const activityClockCoordinator = new ActivityClockCoordinator();
export default ActivityClockCoordinator;
