import { eventBus } from "./EventBus.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
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
 *     useCondition: { requires: [{ itemId, count }] },  // optional
 *     activities: { investigate, use, obtain, lose }, // item-owned blueprints
 *     failMessage, successMessage
 *   }
 */
class ItemManager {
  constructor() {
    /** @type {Map<string, object>} item id -> definition */
    this.defs = new Map();
    /** @type {Map<string, number>} item id -> held count */
    this.inventory = new Map();
    this._loadPromise = null;
  }

  /**
   * Load item definitions + starting inventory (idempotent, and safe to
   * call concurrently from multiple callers - e.g. main.js's boot
   * Promise.all and SaveManager.init() both call this). The in-flight
   * promise itself is cached (not just a boolean flag set after the
   * `await` resolves), so overlapping callers all await the same load
   * instead of racing past the guard and double-applying the starting
   * inventory.
   */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = this._doLoad();
    }
    return this._loadPromise;
  }

  async _doLoad() {
    const data = await dataLoader.loadJSON("items.json");
    (data.items || []).forEach((def) => this.defs.set(def.id, def));
    (data.startingInventory || []).forEach(({ itemId, count }) => {
      this._addRaw(itemId, count || 1);
    });
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
    this._emitItemActivity(id, "obtain", { count });
  }

  remove(id, count = 1) {
    const current = this.inventory.get(id) || 0;
    const next = Math.max(0, current - count);
    if (next <= 0) this.inventory.delete(id);
    else this.inventory.set(id, next);
    eventBus.emit("items:changed", this.snapshot());
    this._emitItemActivity(id, "lose", { count });
  }

  activityFor(id, action) {
    const def = this.defs.get(id);
    const activities = def?.activities || def?.activityTable || {};
    const blueprint = activities[action] || null;
    if (!blueprint || action !== "investigate") return blueprint;
    const nodes = blueprint.nodes || {};
    if (nodes.san?.type !== "segmentBranch") return blueprint;
    const normalImage = nodes["band0:image"]?.inputs?.image;
    const zeroImage = nodes["band6:image"];
    if (!normalImage || !zeroImage) return blueprint;
    // SAN=0 keeps the normal item's appearance; its investigation text is
    // still read from the separate band6:result node.
    const copy = JSON.parse(JSON.stringify(blueprint));
    copy.nodes["band6:image"].inputs.image = normalImage;
    return copy;
  }

  _emitItemActivity(id, action, context = {}) {
    const blueprint = this.activityFor(id, action);
    eventBus.emit("activity:triggered", { source: "item", itemId: id, action, activityId: `${id}:${action}`, blueprint, context });
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

  inspect(id) {
    const def = this.defs.get(id);
    if (!def) return null;
    let result = null;
    this._emitItemActivity(id, "investigate", { onInspection: (inspection) => { result = inspection; } });
    return result;
  }

  /**
   * Map a mental value to the matching SAN-band key used in `sanVariants`.
   * Matches the 7-band layout used by the item editor and game data.
   * @param {number} mental
   * @returns {string}
   */
  _getSanBandKey(mental) {
    if (mental === 0) return "=0";
    if (mental > 90)  return ">90";
    if (mental > 70)  return "70-90";
    if (mental > 50)  return "50-70";
    if (mental > 30)  return "30-50";
    if (mental > 15)  return "15-30";
    return "0-15";
  }

  getDisplayName(id) {
    const def = this.defs.get(id);
    if (!def) return "";
    const variant = def.sanVariants?.[this._getSanBandKey(gameState.sanity)];
    return variant?.name || def.name || "";
  }

  /**
   * Build a `keywordDefs` map covering:
   *   - explicitly listed `revealIds` (with source attribution), and
   *   - any `[[kwId]]` inline markers found inside `text`.
   * The map is what callers pass to `renderHighlightedText` / `bindHighlights`.
   * @param {string} text
   * @param {string[]} revealIds
   * @param {string} itemName
   * @returns {Record<string, object>}
   */
  _buildKeywordDefs(text, revealIds, itemName) {
    const source = `物品-${itemName}`;
    const inlineIds = [];
    const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m;
    while ((m = re.exec(text)) !== null) inlineIds.push(m[1]);
    const allIds = [...new Set([...revealIds, ...inlineIds])];
    return keywordManager.definitionsWithSource(allIds, source);
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
    const variableCondition = def.useCondition?.globalVariables || def.useCondition?.globalVariableCondition;
    if (unmet || !globalVariableManager.matches(variableCondition)) {
      return { ok: false, message: def.failMessage || "当前条件不满足，使用无效。" };
    }

    // SAN 范围条件：书籍仅在 0 < SAN ≤ 50 时可使用
    const sanMin = def.useCondition && def.useCondition.sanMin;
    const sanMax = def.useCondition && def.useCondition.sanMax;
    if (sanMin !== undefined && sanMin > 0 && gameState.sanity < sanMin) {
      return { ok: false, message: def.failMessage || "理智值过低，无法使用。" };
    }
    if (sanMax !== undefined && sanMax > 0 && gameState.sanity > sanMax) {
      return { ok: false, message: def.failMessage || "理智值过高，此时已无法从书籍中学习法术。" };
    }

    const displayName = this.getDisplayName(id);
    const result = { ok: true, message: def.successMessage || `使用了${displayName}。` };
    // Let EndingManager (and anything else) react to a successful item use
    // without ItemManager needing to import it directly.
    // The item-owned activity is now the sole effect/time execution owner.
    this._emitItemActivity(id, "use");

    // 书籍法术学习：0 < SAN ≤ 50 时使用书籍触发，游戏层负责展示学习界面
    if (def.isBook && def.spells && def.spells.length > 0) {
      eventBus.emit("book:learnSpell", {
        id,
        bookName: displayName,
        spells: def.spells, // [{ name, description, learnTimeMinutes:240, castSanCost:5 }]
      });
    }

    return result;
  }

  /**
   * Return the appearance image URL for the given item at the player's
   * current SAN band, or null when no image path has been configured for
   * that band (or the item has no sanVariants at all).
   * @param {string} id
   * @returns {string|null}
   */
  getImage(id) {
    const def = this.defs.get(id);
    if (!def?.sanVariants) return null;
    const bandKey = this._getSanBandKey(gameState.sanity);
    return def.sanVariants[bandKey]?.image || null;
  }

  /**
   * Return true when the item has at least one configured image path across
   * any SAN band (used by the UI to decide whether to show the "外观" button).
   * @param {string} id
   * @returns {boolean}
   */
  hasAnyImage(id) {
    const def = this.defs.get(id);
    if (!def?.sanVariants) return false;
    return Object.values(def.sanVariants).some((v) => v?.image);
  }

  snapshot() {
    return this.all();
  }

  /**
   * Return all item definitions whose `locations` array contains the given key.
   * Key may be a top-level id ("hospital") or a sub-location path ("dorm/ajie_desk").
   * @param {string} locationKey
   * @returns {object[]}
   */
  worldItemsAt(locationKey) {
    const results = [];
    this.defs.forEach((def) => {
      if ((def.locations || []).includes(locationKey)) results.push(def);
    });
    return results;
  }

  /**
   * Return every item definition that belongs to any sub-location of a parent
   * location, keyed by sub-location id. E.g. worldItemsForDorm("dorm") returns
   * { "ajie_desk": [def, …], "fridge": [def, …], … } using keys "dorm/<subId>".
   * Also includes items with just the parent key in the special "." bucket.
   * @param {string} parentLocationId
   * @returns {Map<string, object[]>}
   */
  worldItemsBySubLocation(parentLocationId) {
    const map = new Map();
    const prefix = parentLocationId + "/";
    this.defs.forEach((def) => {
      (def.locations || []).forEach((loc) => {
        if (loc === parentLocationId) {
          const list = map.get(".") || [];
          list.push(def);
          map.set(".", list);
        } else if (loc.startsWith(prefix)) {
          const subId = loc.slice(prefix.length);
          const list = map.get(subId) || [];
          list.push(def);
          map.set(subId, list);
        }
      });
    });
    return map;
  }

  /** Subscribe to any inventory change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("items:changed", handler);
  }
}

export const itemManager = new ItemManager();
export default ItemManager;
