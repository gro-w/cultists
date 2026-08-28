import { eventBus } from "./EventBus.js";
import { createScheduleRunner } from "./ScheduleRunner.js";
import { realtimeQueue } from "./ScheduleQueue.js";
import { timeService } from "./TimeService.js";
import { gameState } from "./GameState.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

let sequence = 0;

function definitionFor(payload) {
  const scheduleId = payload.blueprint?.id || `${payload.source || "item"}:${payload.itemId || payload.actorId || "unknown"}:${payload.action || "event"}`;
  return {
    ...payload.blueprint,
    id: scheduleId,
    blueprint: payload.blueprint,
    itemId: payload.itemId,
    actorId: payload.actorId,
    action: payload.action,
  };
}

function applyEffect(effect = {}) {
  (effect.remove || []).forEach((r) => itemManager.remove(r.itemId, r.count || 1));
  (effect.add || []).forEach((a) => itemManager.add(a.itemId, a.count || 1));
  if (effect.statChanges) gameState.modify(effect.statChanges);
  globalVariableManager.applyEffects(effect.globalVariables || effect.globalVariableChanges);
}

/** Execute item-owned schedules immediately in the non-blocking realtime queue. */
export function runItemSchedule(payload = {}) {
  const definition = definitionFor(payload);
  const instanceId = `${definition.id}:${++sequence}`;
  const instance = { instanceId, scheduleId: definition.id, status: "unresolved", transcript: [] };
  realtimeQueue.append([instance]);
  if (!payload.blueprint) {
    const effect = payload.context?.effect || payload.effect || {};
    applyEffect(effect);
    timeService.advanceBy(Number(payload.context?.timeMinutes || payload.context?.effect?.timeAdvance || payload.timeMinutes || 0));
    if (payload.source === "spell" && payload.action === "cast") eventBus.emit("spell:cast", payload.context?.spell || payload.spell);
    if (payload.source === "npc") eventBus.emit("npc:offline", { actorId: payload.actorId });
    realtimeQueue.complete(instanceId);
    return { ok: true, instance };
  }
  const runner = createScheduleRunner({
    definition,
    instance,
    appId: "item",
    appendLine: () => {},
    onCheckpoint: (next) => realtimeQueue.updateInstance(instanceId, next),
    onComplete: () => realtimeQueue.complete(instanceId),
  });
  return runner.start();
}

export const itemScheduleRuntime = {
  subscribe() {
    return eventBus.on("schedule:triggered", runItemSchedule);
  },
};

itemScheduleRuntime.subscribe();
