import { eventBus } from "./EventBus.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { keywordManager } from "./KeywordManager.js";
import { checkSkill } from "./DiceCheck.js";


/**
 * ItemManager - singleton owning the player's inventory and the data-driven
 * item definitions loaded from `data/items.json`.
 *
 * Item definition shape:
 *   {
 *     id, name,
 *     consumable: boolean,   // removed from inventory after a successful use
 *     usable: boolean,       // whether "使用" is available at all
 *     inspectText: string,   // shown when the player "调查"s the item (used
 *                            // when `inspectCheck` is absent - a plain,
 *                            // always-the-same-result inspection)
 *     revealKeywordIds: string[],  // optional keyword ids (from data/keywords.json) unlocked on inspect
 *     inspectCheck: { skillId: string },  // optional - if set, every 调查
 *                            // re-rolls a CoC-style percentile check against
 *                            // that skill (see DiceCheck.js) instead of
 *                            // always returning `inspectText`, so repeated
 *                            // inspections of the same item can yield
 *                            // different results.
 *     inspectOutcomes: {     // required when inspectCheck is set; one entry
 *                            // per DiceCheck outcome name (criticalSuccess/
 *                            // success/failure/criticalFailure), each:
 *       [outcome]: {
 *         text: string,                    // shown instead of inspectText
 *         revealKeywordIds: string[],      // overrides the top-level list for this outcome
 *         statChanges: { energy, mental, physical, satiety }  // e.g. a criticalFailure spooking the player
 *       }
 *     },
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
    this._emitItemSchedule(id, "obtain", { count });
  }

  remove(id, count = 1) {
    const current = this.inventory.get(id) || 0;
    const next = Math.max(0, current - count);
    if (next <= 0) this.inventory.delete(id);
    else this.inventory.set(id, next);
    eventBus.emit("items:changed", this.snapshot());
    this._emitItemSchedule(id, "lose", { count });
  }

  scheduleFor(id, action) {
    const def = this.defs.get(id);
    const schedules = def?.schedules || def?.scheduleTable || {};
    return schedules[action] || null;
  }

  _emitItemSchedule(id, action, context = {}) {
    const blueprint = this.scheduleFor(id, action);
    eventBus.emit("schedule:triggered", { source: "item", itemId: id, action, blueprint, context });
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

  /**
   * Inspect an item: reveals any associated keywords and returns a result
   * describing what the player saw. Every call counts as one「调查」
   * action (broadcast via `item:inspected` for UI/history consumers).
   *
   * SAN-band variants: if `def.sanVariants` contains an entry matching the
   * player's current SAN level, its `description` overrides `inspectText`
   * and its `revealKeywordIds` are merged with the top-level list.
   *
   * Both `inspectText` / band `description` and `inspectOutcomes[].text`
   * may contain `[[keywordId]]` inline markers. Those are NOT auto-collected
   * on inspect — the player clicks the highlighted span to collect them.
   * Keywords listed in `revealKeywordIds` (top-level or band) ARE
   * auto-collected on every inspect.
   *
   * @returns {{ text: string, check: {roll:number, skillValue:number, outcome:string}|null, keywordDefs: object }}
   */
  inspect(id) {
    const def = this.defs.get(id);
    if (!def) return null;

    // Pick the SAN-band variant for the player's current mental value.
    const bandKey = this._getSanBandKey(gameState.mental);
    const band = def.sanVariants && def.sanVariants[bandKey];

    // Resolve inspectEffect: per-band entry takes priority over top-level.
    const resolvedEffect = (band && band.inspectEffect) || def.inspectEffect || null;

    if (def.inspectCheck && def.inspectCheck.skillId) {
      const check = checkSkill(def.inspectCheck.skillId);
      const outcomes = def.inspectOutcomes || {};
      const outcome =
        outcomes[check.outcome] || outcomes.success || outcomes.failure || {};
      const revealIds = [
        ...(outcome.revealKeywordIds || def.revealKeywordIds || []),
        ...((band && band.revealKeywordIds) || []),
      ];
      const baseText = outcome.text || def.inspectText || "（没有更多可以查看的信息。）";
      const text = (band && band.description) || baseText;
      const effect = {
        ...(resolvedEffect || {}),
        ...(outcome.statChanges ? { statChanges: { ...(resolvedEffect?.statChanges || {}), ...outcome.statChanges } } : {}),
      };
      this._emitItemSchedule(id, "inspect", { effect, timeMinutes: def.inspectTimeAdvance || 0 });
      const keywordDefs = this._buildKeywordDefs(text, revealIds, def.name);
      revealIds.forEach((kid) => { const k = keywordDefs[kid]; if (k) keywordManager.collect(k); });
      return { text, check, keywordDefs, effect: resolvedEffect };
    }

    const revealIds = [
      ...(def.revealKeywordIds || []),
      ...((band && band.revealKeywordIds) || []),
    ];
    const text = (band && band.description) || def.inspectText || "（没有更多可以查看的信息。）";
    const keywordDefs = this._buildKeywordDefs(text, revealIds, def.name);
    this._emitItemSchedule(id, "inspect", { effect: resolvedEffect, timeMinutes: def.inspectTimeAdvance || 0 });
    revealIds.forEach((kid) => { const k = keywordDefs[kid]; if (k) keywordManager.collect(k); });
    return { text, check: null, keywordDefs, effect: resolvedEffect };
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
    if (sanMin !== undefined && sanMin > 0 && gameState.mental < sanMin) {
      return { ok: false, message: def.failMessage || "理智值过低，无法使用。" };
    }
    if (sanMax !== undefined && sanMax > 0 && gameState.mental > sanMax) {
      return { ok: false, message: def.failMessage || "理智值过高，此时已无法从书籍中学习法术。" };
    }

    const effect = { ...(def.useEffect || {}) };
    if (def.consumable) effect.remove = [...(effect.remove || []), { itemId: id, count: 1 }];
    const result = { ok: true, message: def.successMessage || `使用了${def.name}。` };
    // Let EndingManager (and anything else) react to a successful item use
    // without ItemManager needing to import it directly.
    // The item-owned schedule is now the sole effect/time execution owner.
    this._emitItemSchedule(id, "use", { effect, timeMinutes: effect.timeAdvance || 0 });

    // 书籍法术学习：0 < SAN ≤ 50 时使用书籍触发，游戏层负责展示学习界面
    if (def.isBook && def.spells && def.spells.length > 0) {
      eventBus.emit("book:learnSpell", {
        id,
        bookName: def.name,
        spells: def.spells, // [{ name, description, learnTimeMinutes:240, castSanCost:5 }]
      });
    }

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
