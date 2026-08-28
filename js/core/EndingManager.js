import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

/**
 * EndingManager - singleton resolving every path that can end the game,
 * driven entirely by `data/endings.json`:
 *   - event-based: dialogue nodes call `endingManager.trigger(id)` directly
 *     via their `onShow.ending` field (see DialogueEffects.js).
 *   - item-based: ItemManager emits `item:used` after a successful use();
 *     if the item's `useEffect.ending` is set, that ending triggers.
 *   - stat-threshold-based: checked on every `gamestate:changed` event
 *     against the configured `statTriggers` (e.g. satiety > 150).
 *   - time-based: `resolveFinalEnding()` is called by DayNightSystem once
 *     the last authored day/night phase is reached, picking the first
 *     matching `finalConditions` entry (or `defaultEndingId` as a fallback).
 *
 * Once any ending triggers, `endingManager.isEnded` becomes true and no
 * further ending can trigger (first ending wins).
 */
class EndingManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.defs = new Map();
    this.statTriggers = [];
    this.finalConditions = [];
    this.defaultEndingId = null;
    this._loadPromise = null;
    this._ended = false;
  }

  /**
   * Load `data/endings.json` (idempotent, and safe to call concurrently
   * from multiple callers - the in-flight promise is cached so overlapping
   * callers all await the same load instead of racing past a boolean
   * guard set only after the `await` resolves, which would otherwise
   * double-register the gamestate:changed/item:used listeners below).
   */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("endings.json").then((data) => {
        (data.endings || []).forEach((e) => this.defs.set(e.id, e));
        this.statTriggers = data.statTriggers || [];
        this.finalConditions = data.finalConditions || [];
        this.defaultEndingId = data.defaultEndingId || null;

        eventBus.on("gamestate:changed", (snapshot) => this._checkStatTriggers(snapshot));
        eventBus.on("item:used", ({ id, result }) => {
          if (!result || !result.ok) return;
          const def = itemManager.getDef(id);
          const endingId = def && def.useEffect && def.useEffect.ending;
          if (endingId) this.trigger(endingId);
        });
      });
    }
    return this._loadPromise;
  }

  _checkStatTriggers(snapshot) {
    if (this._ended) return;
    for (const t of this.statTriggers) {
      const value = snapshot[t.stat];
      if (value == null) continue;
      if (this._compare(value, t.op, t.value)) {
        this.trigger(t.endingId);
        return;
      }
    }
  }

  _compare(value, op, target) {
    switch (op) {
      case "gt":
        return value > target;
      case "gte":
        return value >= target;
      case "lt":
        return value < target;
      case "lte":
        return value <= target;
      default:
        return value === target;
    }
  }

  /** Trigger an ending by id (no-op if the game has already ended, or the id is unknown). */
  trigger(endingId) {
    if (this._ended) return;
    const def = this.defs.get(endingId);
    if (!def) {
      console.warn(`[EndingManager] Unknown ending id "${endingId}".`);
      return;
    }
    this._ended = true;
    eventBus.emit("ending:triggered", def);
  }

  /** Resolve the time-based ending once the final authored day/night is reached. */
  resolveFinalEnding() {
    if (this._ended) return;
    for (const cond of this.finalConditions) {
      if (this._matchesFinalCondition(cond)) {
        this.trigger(cond.endingId);
        return;
      }
    }
    if (this.defaultEndingId) this.trigger(this.defaultEndingId);
  }

  _matchesFinalCondition(cond) {
    if (cond.requires && !cond.requires.every((r) => itemManager.has(r.itemId, r.count || 1))) {
      return false;
    }
    const snapshot = gameState.snapshot();
    if (cond.statAtLeast) {
      for (const [stat, min] of Object.entries(cond.statAtLeast)) {
        if ((snapshot[stat] ?? 0) < min) return false;
      }
    }
    if (cond.statAtMost) {
      for (const [stat, max] of Object.entries(cond.statAtMost)) {
        if ((snapshot[stat] ?? 0) > max) return false;
      }
    }
    if (!globalVariableManager.matches(cond.globalVariables || cond.globalVariableCondition)) return false;
    return true;
  }

  get isEnded() {
    return this._ended;
  }

  /** Subscribe to the ending being triggered; handler receives the ending def. */
  onEnding(handler) {
    return eventBus.on("ending:triggered", handler);
  }

  /** Used by SaveManager when restoring a save from before any ending happened. */
  reset() {
    this._ended = false;
  }
}

export const endingManager = new EndingManager();
export default EndingManager;
