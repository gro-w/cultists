import { eventBus } from "./EventBus.js";
import { activityData } from "./ActivityData.js";
import { gameState } from "./GameState.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

class ActivityClockCoordinator {
  constructor() {
    this._unsubscribe = eventBus.on("time:changed", () => this._sync());
    this._unsubscribeSettlement = eventBus.on("day:settled", (result) => {
      result.medical = medicalCaseManager.settleDay(Number(result.day) - 1);
    });
    this._syncing = false;
  }

  _sync() {
    if (this._syncing) return;
    this._syncing = true;
    try {
      activityData.advanceTo(gameState.day, gameState.clockMinutes);
      medicalCaseManager.processDue(gameState.day, gameState.clockMinutes).forEach((request) => {
        const result = activityData.enqueueMedicalIncident(request);
        if (result.ok) medicalCaseManager.submissions.get(request.submission.patientId).processed = true;
      });
    } finally {
      this._syncing = false;
    }
  }
}

export const activityClockCoordinator = new ActivityClockCoordinator();
export default ActivityClockCoordinator;
