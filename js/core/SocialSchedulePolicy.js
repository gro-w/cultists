import { eventBus } from "./EventBus.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

const SOCIAL_COMPLETION_VARIABLES = Object.freeze({ ajie: 100, awei: 101 });

/** Social-domain completion consequences kept outside the generic queue. */
class SocialSchedulePolicy {
  constructor() {
    this._unsubscribe = eventBus.on("schedule:completed", ({ queueId, instance }) => {
      if (queueId !== "social") return;
      const npcId = instance?.payload?.npcId || instance?.npcId;
      const variableId = SOCIAL_COMPLETION_VARIABLES[npcId];
      if (variableId !== undefined && globalVariableManager.definition(variableId)) {
        globalVariableManager.set(variableId, true);
      }
    });
  }

  destroy() {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
}

export const socialSchedulePolicy = new SocialSchedulePolicy();
export default SocialSchedulePolicy;
