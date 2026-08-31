import { eventBus } from "./EventBus.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";
import { runItemActivity } from "./ItemActivityRuntime.js";

const PRODUCERS = new Set(["item", "spell", "npc"]);

class ActivityTriggerRouter {
  constructor() {
    this._unsubscribe = eventBus.on(ACTIVITY_EVENTS.requested, (request) => {
      if (!PRODUCERS.has(request?.source)) return;
      runItemActivity(request);
    });
  }

  dispose() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}

export const activityTriggerRouter = new ActivityTriggerRouter();
export default ActivityTriggerRouter;
