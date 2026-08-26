import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { keywordManager } from "./KeywordManager.js";

/**
 * ItemManager - singleton owning the player's inventory and the data-driven
 * item definitions loaded from `data/items.json`.
 *
 * Item definition shape:
 *   {
 *     id, name,
 *     consumable: boolean,   // removed from inventory after a successful use
 *     usable: boolean,       // whether "使用" is available at all
 *     inspectText: string,   // shown when the player "调查"s the item
 *     revealKeywordIds: string[],  // optional keyword ids (from data/keywords.json) unlocked on inspect
 *     useCondition: { requires: [{ itemId, count }] },  // optional
 *     useEffect: {
 *       remove: [{ itemId, count }],
 *       add: [{ itemId, count }],
 *       statChanges: { energy, mental, physical, satiety },
 *       ending: string  // optional ending id (data/endings.json) triggered on success
 *     },
 *     failMessage, successMessage
 *   }
 */
class ItemManager {
  constructor() {
    /** @type {Map<string, object>} item id -> definition */
    this.defs = new Map();
    /** @type {Map<string, number>} item id -> held count */
    this.inventory = new Map();
    this._loaded = false;
  }

  /** Load item definitions + starting inventory (idempotent). */
  async load() {
    if (this._loaded) return;
    const data = await dataLoader.loadJSON("items.json");
    (data.items || []).forEach((def) => this.defs.set(def.id, def));
    (data.startingInventory || []).forEach(({ itemId, count }) => {
      this._addRaw(itemId, count || 1);
    });
    this._loaded = true;
    eventBus.emit("items:changed", this.snapshot());
  }

  getDef(id) {
    return this.defs.get(id);
  }

  /** All item ids known to the game, in definition (data file) order. */
  allDefIds() {
    return [...this.defs.keys()];
  }

  has(id, count = 1) {
    return (this.inventory.get(id) || 0) >= count;
  }

  count(id) {
    return this.inventory.get(id) || 0;
  }

  _addRaw(id, count) {
    const next = (this.inventory.get(id) || 0) + count;
    if (next <= 0) this.inventory.delete(id);
    else this.inventory.set(id, next);
  }

  add(id, count = 1) {
    this._addRaw(id, count);
    eventBus.emit("items:changed", this.snapshot());
  }

  remove(id, count = 1) {
    const current = this.inventory.get(id) || 0;
    const next = Math.max(0, current - count);
    if (next <= 0) this.inventory.delete(id);
    else this.inventory.set(id, next);
    eventBus.emit("items:changed", this.snapshot());
  }

  /** Replace the whole inventory (used by SaveManager when restoring a save). */
  restoreInventory(entries) {
    this.inventory = new Map();
    (entries || []).forEach(({ id, count }) => {
      if (count > 0) this.inventory.set(id, count);
    });
    eventBus.emit("items:changed", this.snapshot());
  }

  /** Every held item, with its definition attached, in inventory Map order. */
  all() {
    return [...this.inventory.entries()]
      .map(([id, count]) => ({ id, count, def: this.defs.get(id) }))
      .filter((entry) => entry.def);
  }

  /** Inspect an item: reveals any associated keywords and returns its blurb. */
  inspect(id) {
    const def = this.defs.get(id);
    if (!def) return null;
    const keywordDefs = keywordManager.definitionsWithSource(def.revealKeywordIds || [], `物品-${def.name}`);
    Object.values(keywordDefs).forEach((k) => keywordManager.collect(k));
    return def.inspectText || "（没有更多可以查看的信息。）";
  }

  /**
   * Attempt to use an item, applying its configured condition/effect.
   * @returns {{ ok: boolean, message: string }}
   */
  use(id) {
    const def = this.defs.get(id);
    if (!def) return { ok: false, message: "未知物品。" };
    if (!def.usable) return { ok: false, message: "这个物品不可以使用。" };
    if (!this.has(id, 1)) return { ok: false, message: "你没有持有这个物品。" };

    const requires = (def.useCondition && def.useCondition.requires) || [];
    const unmet = requires.some((r) => !this.has(r.itemId, r.count || 1));
    if (unmet) {
      return { ok: false, message: def.failMessage || "当前条件不满足，使用无效。" };
    }

    const effect = def.useEffect || {};
    (effect.remove || []).forEach((r) => this.remove(r.itemId, r.count || 1));
    (effect.add || []).forEach((a) => this.add(a.itemId, a.count || 1));
    if (effect.statChanges) gameState.modify(effect.statChanges);
    if (def.consumable) this.remove(id, 1);

    const result = { ok: true, message: def.successMessage || `使用了${def.name}。` };
    // Let EndingManager (and anything else) react to a successful item use
    // without ItemManager needing to import it directly.
    eventBus.emit("item:used", { id, result });
    return result;
  }

  snapshot() {
    return this.all();
  }

  /** Subscribe to any inventory change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("items:changed", handler);
  }
}

export const itemManager = new ItemManager();
export default ItemManager;
