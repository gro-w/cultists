import { eventBus } from "./EventBus.js";
import { activityData } from "./ActivityData.js";
import { gameState } from "./GameState.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

/** Coordinates delayed medical work without owning Activity clock arithmetic. */
class MedicalClockCoordinator {
  constructor() {
    this._processing = false;
    this._unsubscribeTime = eventBus.on("time:changed", () => this.processDue());
    this._unsubscribeSettlement = eventBus.on("day:settled", (result) => {
      result.medical = this.settleDay(result);
    });
  }

  processDue() {
    if (this._processing) return;
    this._processing = true;
    try {
      medicalCaseManager.processDue(gameState.day, gameState.clockMinutes).forEach((request) => {
        const result = activityData.enqueueMedicalIncident(request);
        if (result.ok) {
          const submission = medicalCaseManager.submissions.get(request.submission.patientId);
          if (submission) submission.processed = true;
        }
      });
    } finally {
      this._processing = false;
    }
  }

  settleDay(result = {}) {
    const medical = medicalCaseManager.settleDay(Number(result.day) - 1);
    eventBus.emit("medical:day-settled", { day: result.day, medical });
    return medical;
  }

  dispose() {
    this._unsubscribeTime?.();
    this._unsubscribeSettlement?.();
  }
}

export const medicalClockCoordinator = new MedicalClockCoordinator();
export default MedicalClockCoordinator;
