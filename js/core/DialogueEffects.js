import { itemManager } from "./ItemManager.js";
import { endingManager } from "./EndingManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { eventBus } from "./EventBus.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { applyScheduleOperations } from "./ScheduleOperations.js";
import { bgmManager } from "./BgmManager.js";

/**
 * applyDialogueOnShow - applies a dialogue node's optional `onShow` effects
 * (shared by HISApp/SocialApp/MonitorApp, and ChatGTPApp's dialogue-mode
 * tab, so any dialogueTree can grant items, remove items, nudge an actor's
 * own SAN, and/or trigger an event-based ending just by reaching a node).
 *
 * Node shape: `{ onShow?: { grantItems, removeItems, ending, npcSanChange } }`
 *   grantItems: [{ itemId, count }]
 *   removeItems: [{ itemId, count }]
 *   ending: string - an ending id from `data/endings.json`
 *   npcSanChange: number - delta applied to `actorId`'s own SAN via
 *     NpcStateManager (positive reassures them, negative unsettles them;
 *     crossing the configured offline threshold takes them out of further
 *     conversation - see NpcStateManager.js). Ignored if `actorId` is
 *     falsy (e.g. a caller that hasn't opted into per-actor SAN).
 * @param {object} node
 * @param {string} [actorId] - the patient/contact/NPC id this node belongs
 *   to (its own SAN, distinct from the protagonist's `gameState.mental`).
 */
/**
 * Extended onShow fields supported by this function:
 *   favorabilityChange: { npcId: "ajie"|"awei"|"binbin", delta: number }
 *     Mutates the named NPC's favourability via FavorabilityManager and
 *     emits `favorability:changed` so AchievementManager can react.
 *
 * All other fields (grantItems, removeItems, ending, npcSanChange) are
 * unchanged from the original implementation.
 */
export function applyDialogueOnShow(node, actorId) {
  const onShow = node && node.onShow;
  if (!onShow) return;
  (onShow.grantItems || []).forEach((g) => itemManager.add(g.itemId, g.count || 1));
  (onShow.removeItems || []).forEach((r) => itemManager.remove(r.itemId, r.count || 1));
  if (actorId && typeof onShow.npcSanChange === "number") {
    npcStateManager.modify(actorId, onShow.npcSanChange);
  }
  if (onShow.ending) endingManager.trigger(onShow.ending);

  // Favourability change (new field)
  const fc = onShow.favorabilityChange;
  if (fc && fc.npcId && typeof fc.delta === "number") {
    favorabilityManager.modify(fc.npcId, fc.delta);
  }

  // Game-semantic events for the achievement system
  if (onShow.gameEvent) {
    eventBus.emit(onShow.gameEvent, onShow.gameEventPayload || {});
  }
  globalVariableManager.applyEffects(onShow.globalVariables || onShow.globalVariableChanges);
  applyScheduleOperations(onShow);

  // BGM layer: onShow.bgm = { action: "play"|"restore"|"stop", bgmId?: string }
  const bgm = onShow.bgm;
  if (bgm && bgm.action) {
    bgmManager.applyDialogueBgm(bgm.action, bgm.bgmId || null);
  }
}
