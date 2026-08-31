import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";

import { globalVariableManager } from "./GlobalVariableManager.js";
import { itemManager } from "./ItemManager.js";

/**
 * EndingManager - singleton resolving every path that can end the game,
 * driven entirely by `data/endings.json`:
 *   - event-based: dialogue nodes call `endingManager.trigger(id)` directly
 *     via their `onShow.ending` field (see DialogueEffects.js).
 *   - item-based: item activity operation nodes can call `trigger(id)` through `onShow`.
 *   - stat-threshold-based: checked on every `gamestate:changed` event
 *     against the configured `statTriggers` (e.g. satiety > 150).
 *   - time-based: `resolveFinalEnding()` is called by DayNightSystem once
 *     the last authored day/night phase is reached, picking the matching
 *     `finalConditions` entry with the highest ending priority (or
 *     `defaultEndingId` as a fallback).
 *
 * Once an ending triggers, it becomes the active ending for this playthrough.
 * If another candidate is triggered later, the ending with the higher
 * data-defined `priority` wins; equal priorities keep the earlier candidate.
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
    this._endingId = null;
    this._endingPriority = null;
    this._restoring = false;
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

      });
    }
    return this._loadPromise;
  }

  _checkStatTriggers(snapshot) {
    if (this._restoring) return;
    const candidates = [];
    for (const t of this.statTriggers) {
      const value = snapshot[t.stat];
      if (value == null) continue;
      if (this._compare(value, t.op, t.value)) {
        candidates.push(t.endingId);
      }
    }
    this._triggerHighestPriority(candidates);
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

  _priority(endingId) {
    const priority = Number(this.defs.get(endingId)?.priority);
    return Number.isFinite(priority) ? priority : 0;
  }

  _triggerHighestPriority(endingIds) {
    const uniqueIds = [...new Set(endingIds)].filter((id) => this.defs.has(id));
    if (!uniqueIds.length) return false;
    let winner = uniqueIds[0];
    for (const id of uniqueIds.slice(1)) {
      if (this._priority(id) > this._priority(winner)) winner = id;
    }
    return this.trigger(winner);
  }

  /** Trigger an ending by id; a higher-priority candidate may replace a lower one. */
  trigger(endingId) {
    if (this._restoring) return false;
    const def = this.defs.get(endingId);
    if (!def) {
      console.warn(`[EndingManager] Unknown ending id "${endingId}".`);
      return false;
    }
    const priority = this._priority(endingId);
    if (this._ended && priority <= this._endingPriority) return false;
    this._ended = true;
    this._endingId = endingId;
    this._endingPriority = priority;
    eventBus.emit("ending:triggered", def);
    return true;
  }

  /** Resolve the time-based ending once the final authored day/night is reached. */
  resolveFinalEnding() {
    const candidates = [];
    for (const cond of this.finalConditions) {
      if (this._matchesFinalCondition(cond)) {
        candidates.push(cond.endingId);
      }
    }
    if (candidates.length) {
      this._triggerHighestPriority(candidates);
      return;
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

  snapshot() {
    return {
      ended: this._ended === true,
      endingId: this._endingId,
      priority: this._endingPriority,
    };
  }

  restore(snapshot = {}) {
    this._ended = snapshot?.ended === true;
    this._endingId = this._ended && this.defs.has(snapshot?.endingId) ? snapshot.endingId : null;
    this._endingPriority = this._endingId ? this._priority(this._endingId) : null;
    eventBus.emit("ending:restored", this.snapshot());
  }

  beginRestore() { this._restoring = true; }

  endRestore() { this._restoring = false; }

  /** Subscribe to the ending being triggered; handler receives the ending def. */
  onEnding(handler) {
    return eventBus.on("ending:triggered", handler);
  }

  onReset(handler) {
    return eventBus.on("ending:reset", handler);
  }

  /** Used by SaveManager when restoring a save from before any ending happened. */
  reset() {
    this._ended = false;
    this._endingId = null;
    this._endingPriority = null;
    eventBus.emit("ending:reset", this.snapshot());
  }
}

export const endingManager = new EndingManager();
export default EndingManager;
