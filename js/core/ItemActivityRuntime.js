import { eventBus } from "./EventBus.js";
import { activityExecutionService } from "./ActivityExecutionService.js";
import { mainQueue } from "./ActivityQueue.js";
import { timeService } from "./TimeService.js";
import { gameState } from "./GameState.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";
import { displayReceiverManager } from "./DisplayReceiverManager.js";


let sequence = 0;

function definitionFor(payload) {
  const activityId = payload.activityId || payload.blueprint?.id || `${payload.source || "item"}:${payload.itemId || payload.actorId || "unknown"}:${payload.action || "event"}`;
  return {
    ...payload.blueprint,
    id: activityId,
    blueprint: payload.blueprint,
    itemId: payload.itemId,
    actorId: payload.actorId,
    action: payload.action,
  };
}

function applyEffect(effect = {}) {
  let result = null;
  (effect.remove || []).forEach((r) => itemManager.remove(r.itemId, r.count || 1));
  (effect.add || []).forEach((a) => itemManager.add(a.itemId, a.count || 1));
  if (effect.statChanges) gameState.modify(effect.statChanges);
  (effect.npcSanChanges || []).forEach((change) => npcStateManager.modify(change.actorId, change.delta));
  (effect.npcOffline || []).forEach((actorId) => npcStateManager.completeOffline(actorId));
  if (effect.medicalSubmission) {
    result = medicalCaseManager.submit(effect.medicalSubmission);
    if (!result.ok) throw new Error(`Medical submission failed: ${result.reason}`);
  }
  globalVariableManager.applyEffects(effect.globalVariables || effect.globalVariableChanges);
  if (effect.gameEvent) eventBus.emit(effect.gameEvent, effect.gameEventPayload || {});
  return result;
}

/** Execute item-owned activities immediately in the non-blocking main queue. */
export function runItemActivity(payload = {}) {
  const definition = definitionFor(payload);
  const instanceId = `${definition.id}:${++sequence}`;
  const queue = mainQueue;
  let instance = payload.instance || { instanceId, activityId: definition.id, status: "unresolved", transcript: [] };
  // A producer may pass a pre-created instance (for example a ChatGTP query),
  // but every runtime execution must still be represented in its queue. NPC
  // threshold transitions use this path without pre-appending an instance.
  if (queue.statusOf(instance.instanceId) === "nonexistent") {
    [instance] = queue.append([instance]);
  } else {
    instance = queue.getInstance(instance.instanceId) || instance;
  }
  if (!payload.blueprint) {
    const effect = payload.context?.effect || payload.effect || {};
    const effectResult = applyEffect(effect);
    timeService.advanceBy(Number(payload.context?.timeMinutes || payload.context?.effect?.timeAdvance || payload.timeMinutes || 0));
    if (payload.source === "spell" && (payload.action === "use" || payload.action === "cast")) {
      eventBus.emit("spell:cast", { spell: payload.context?.spell || payload.spell, context: payload.context || {} });
    }
    if (payload.source === "npc") eventBus.emit("npc:offline", { actorId: payload.actorId });
    queue.complete(instance.instanceId);
    payload.context?.onComplete?.({ ...instance, result: effectResult });
    return { ok: true, instance };
  }
  const offDisplay = displayReceiverManager.register("item-inspection", ({ type, image }) => {
    if (type === "image" && image) instance.inspectionImage = image;
  });
  const runner = activityExecutionService.run({
    queue,
    definition,
    instance,
    appId: "item",
    appendLine: () => {},

    onItemInspection: (result) => payload.context?.onInspection?.(result),
    onComplete: (next) => {
      offDisplay();
      queue.complete(instance.instanceId);
      payload.context?.onComplete?.(next);
    },
  });
  return runner ? { ok: true } : { ok: false, reason: "activity execution unavailable" };
}

export const itemActivityRuntime = {
  run: runItemActivity,
};
