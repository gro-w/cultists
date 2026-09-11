import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

import { itemManager } from "./ItemManager.js";

/**
 * Owns conditional world-item placements. A placement is separate from the
 * inventory: it can be visible in a scene, taken into the inventory, and put
 * back later without confusing "not owned" with "currently placed".
 */
class ItemPlacementManager {
  constructor() {
    this.placements = [];
    this.placed = new Map();
    this._roommateHidden = new Set();
    this._loadPromise = null;
  }

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("item_placements.json").then((data) => {
        this.placements = data.placements || [];
        this.placements.forEach((placement) => this.placed.set(placement.id, placement.initiallyPlaced !== false));
      });
    }
    return this._loadPromise;
  }

  all() {
    return [...this.placements];
  }

  get(id) {
    return this.placements.find((placement) => placement.id === id) || null;
  }

  isPlaced(id) {
    return this.placed.get(id) === true;
  }

  /** Return true if the item was hidden by a roommate catching the player snooping. */
  isHiddenByRoommate(id) {
    return this._roommateHidden.has(id);
  }

  /** Hide an item permanently (roommate found the player investigating at night). */
  hideByRoommate(id) {
    this._roommateHidden.add(id);
    eventBus.emit("item-placements:changed", this.snapshot());
  }

  _clockMinutes() {
    const start = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    return (start + (gameState.clockMinutes - start + 1440) % 1440) % 1440;
  }

  _conditionMatches(condition = {}) {
    if (condition.dayMin != null && gameState.day < condition.dayMin) return false;
    if (condition.dayMax != null && gameState.day > condition.dayMax) return false;
    if (condition.phase && condition.phase !== gameState.phase) return false;
    if (condition.location && condition.location !== gameState.location) return false;
    if (condition.roommatesSleeping !== undefined) {
      const minutes = this._clockMinutes();
      const sleeping = minutes >= 22 * 60 + 40 || minutes < 7 * 60 + 40;
      if (condition.roommatesSleeping !== sleeping) return false;
    }
    if (!globalVariableManager.matches(condition.globalVariables || condition.globalVariableCondition)) return false;
    return true;
  }

  isVisible(id) {
    const placement = this.get(id);
    return Boolean(
      placement &&
      this.isPlaced(id) &&
      !this._roommateHidden.has(id) &&
      this._conditionMatches(placement.condition)
    );
  }

  visibleFor(location) {
    return this.placements.filter((placement) => placement.location === location && this.isVisible(placement.id));
  }

  inspect(id) {
    const placement = this.get(id);
    if (!placement || !this.isVisible(id)) return { ok: false, message: "这里现在没有这个物品。" };
    const result = itemManager.inspect(placement.itemId);
    return { ok: true, placement, result };
  }

  take(id) {
    const placement = this.get(id);
    if (!placement || !this.isVisible(id)) return { ok: false, message: "这里现在没有这个物品。" };
    itemManager.add(placement.itemId, 1);
    this.placed.set(id, false);
    eventBus.emit("item-placements:changed", this.snapshot());
    return { ok: true, message: placement.takeMessage || `你拿起了${itemManager.getDef(placement.itemId)?.name || "物品"}。` };
  }

  putBack(id) {
    const placement = this.get(id);
    if (!placement || this.isPlaced(id)) return { ok: false, message: "这个物品已经放在原处。" };
    if (!itemManager.has(placement.itemId, 1)) return { ok: false, message: "你没有携带这个物品。" };
    itemManager.remove(placement.itemId, 1);
    this.placed.set(id, true);
    eventBus.emit("item-placements:changed", this.snapshot());
    return { ok: true, message: placement.returnMessage || "你把物品放回了原处。" };
  }

  setPlaced(id, placed) {
    const placement = this.get(id);
    if (!placement) return false;
    const nextPlaced = placed === true;
    const currentPlaced = this.isPlaced(id);
    if (currentPlaced === nextPlaced) return true;
    if (nextPlaced) {
      if (!itemManager.has(placement.itemId)) return false;
      itemManager._addRaw(placement.itemId, -1);
    } else {
      itemManager._addRaw(placement.itemId, 1);
    }
    this.placed.set(id, nextPlaced);
    eventBus.emit("items:changed", itemManager.snapshot());
    eventBus.emit("item-placements:changed", this.snapshot());
    return true;
  }

  snapshot() {
    return {
      placements: this.placements.map((placement) => ({ id: placement.id, placed: this.isPlaced(placement.id) })),
      roommateHidden: [...this._roommateHidden],
    };
  }

  restore(data = {}) {
    // Accept both old (array) and new (object) snapshot formats
    const entries = Array.isArray(data) ? data : (data.placements || []);
    const hiddenIds = Array.isArray(data.roommateHidden) ? data.roommateHidden : [];
    const values = new Map(entries.map((entry) => [entry.id, entry.placed === true]));
    this.placements.forEach((placement) => {
      this.placed.set(placement.id, placement.initiallyPlaced !== false);
      if (values.has(placement.id)) this.placed.set(placement.id, values.get(placement.id));
    });
    this._roommateHidden = new Set(hiddenIds);
    eventBus.emit("item-placements:changed", this.snapshot());
  }
}

export const itemPlacementManager = new ItemPlacementManager();
export default ItemPlacementManager;
