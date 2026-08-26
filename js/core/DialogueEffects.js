import { itemManager } from "./ItemManager.js";
import { endingManager } from "./EndingManager.js";

/**
 * applyDialogueOnShow - applies a dialogue node's optional `onShow` effects
 * (shared by HISApp/SocialApp so patient/contact dialogue trees can grant
 * items, remove items, and/or trigger an event-based ending just by
 * reaching a given node).
 *
 * Node shape: `{ onShow?: { grantItems, removeItems, ending } }`
 *   grantItems: [{ itemId, count }]
 *   removeItems: [{ itemId, count }]
 *   ending: string - an ending id from `data/endings.json`
 */
export function applyDialogueOnShow(node) {
  const onShow = node && node.onShow;
  if (!onShow) return;
  (onShow.grantItems || []).forEach((g) => itemManager.add(g.itemId, g.count || 1));
  (onShow.removeItems || []).forEach((r) => itemManager.remove(r.itemId, r.count || 1));
  if (onShow.ending) endingManager.trigger(onShow.ending);
}
