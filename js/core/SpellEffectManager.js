import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { endingManager } from "./EndingManager.js";
import { socialQueue } from "./ScheduleQueue.js";
import { specialEventManager } from "./SpecialEventManager.js";
import { itemEffectHistory } from "./ItemEffectHistory.js";

/**
 * Data-driven consequences of successfully casting a learned spell.
 * The cast cost is applied by ItemScheduleRuntime before this listener runs.
 * Context is supplied by a spell-cast node or a future UI target selector.
 */
class SpellEffectManager {
  constructor() {
    this._wakeSanityZero = false;
    this._sleepEventId = null;
    this._subscribed = false;
  }

  mount() {
    if (this._subscribed) return;
    this._subscribed = true;
    eventBus.on("spell:cast", ({ spell, context = {} } = {}) => this.handleCast(spell, context));
    eventBus.on("day:settled", () => {
      if (!this._wakeSanityZero) return;
      this._wakeSanityZero = false;
      gameState.modify({ sanity: -gameState.sanity });
      if (this._sleepEventId) {
        this._queueSpecialEvent(this._sleepEventId);
        this._sleepEventId = null;
      }
    });
  }

  handleCast(spell, context = {}) {
    const effect = spell?.effect || {};
    switch (effect.type) {
      case "domination":
        if (["追逐", "追逐事件"].includes(context.eventId) && context.choiceId === "cast_domination") {
          return { branch: "abnormal" };
        }
        break;
      case "seal_activation":
        if (["追逐", "追逐事件"].includes(context.eventId) && context.choiceId === "use_talisman") {
          const targetItemId = context.targetItemId || context.target || "swastika";
          const wasApplied = itemEffectHistory.has(targetItemId, "seal_activation");
          itemEffectHistory.record(targetItemId, "seal_activation");
          return { branch: wasApplied ? "abnormal" : "normal" };
        }
        if (context.targetItemId || context.target) itemEffectHistory.record(context.targetItemId || context.target, "seal_activation");
        break;
      case "disease":
        if (context.target === "self") {
          endingManager.trigger(effect.selfEnding || "自杀结局");
        } else {
          eventBus.emit("spell:disease_applied", { spell, target: context.target || null });
        }
        break;
      case "deep_ones_contact":
        if (gameState.sanity > Number(effect.sanThreshold ?? 30)) {
          this._queueSpecialEvent(effect.event || "与海之子对话");
        } else {
          endingManager.trigger(effect.ending || "蹈海");
        }
        break;
      case "cthulhu_contact":
        this._wakeSanityZero = true;
        this._sleepEventId = effect.sleepEvent || "长眠的克苏鲁候汝入梦";
        break;
      default:
        break;
    }
  }

  _queueSpecialEvent(eventId) {
    const event = specialEventManager.events.find((entry) => entry.id === eventId);
    if (!event?.blueprint) {
      eventBus.emit("spell:event-requested", { eventId });
      return;
    }
    const existing = socialQueue.getPending().some((entry) => entry.scheduleId === eventId);
    if (!existing) socialQueue.append([{ ...event, scheduleId: eventId, receivedDay: gameState.day, receivedTime: gameState.clockMinutes }]);
    eventBus.emit("spell:event-requested", { eventId });
  }

  resetTransientState() {
    this._wakeSanityZero = false;
    this._sleepEventId = null;
  }
}

export const spellEffectManager = new SpellEffectManager();
spellEffectManager.mount();
export default SpellEffectManager;
