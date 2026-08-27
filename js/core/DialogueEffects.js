import { itemManager } from "./ItemManager.js";
import { endingManager } from "./EndingManager.js";
import { npcStateManager } from "./NpcStateManager.js";

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
export function applyDialogueOnShow(node, actorId) {
  const onShow = node && node.onShow;
  if (!onShow) return;
  (onShow.grantItems || []).forEach((g) => itemManager.add(g.itemId, g.count || 1));
  (onShow.removeItems || []).forEach((r) => itemManager.remove(r.itemId, r.count || 1));
  if (actorId && typeof onShow.npcSanChange === "number") {
    npcStateManager.modify(actorId, onShow.npcSanChange);
  }
  if (onShow.ending) endingManager.trigger(onShow.ending);
}
