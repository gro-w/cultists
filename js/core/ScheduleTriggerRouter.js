import { eventBus } from "./EventBus.js";
import { ACTIVITY_EVENTS } from "./ScheduleEvents.js";
import { runItemSchedule } from "./ItemScheduleRuntime.js";

const PRODUCERS = new Set(["item", "spell", "npc"]);

class ScheduleTriggerRouter {
  constructor() {
    this._unsubscribe = eventBus.on(ACTIVITY_EVENTS.requested, (request) => {
      if (!PRODUCERS.has(request?.source)) return;
      runItemSchedule(request);
    });
  }

  dispose() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}

export const scheduleTriggerRouter = new ScheduleTriggerRouter();
export default ScheduleTriggerRouter;
