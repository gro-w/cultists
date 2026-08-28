import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { itemManager } from "./ItemManager.js";
import { actionBudget } from "./ActionBudget.js";

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

/**
 * NpcStateManager - singleton tracking every NPC's own SAN (精神值),
 * separate from the protagonist's `gameState.mental`. The player's dialogue
 * choices can nudge an NPC's SAN up or down via a dialogue node's
 * `onShow.npcSanChange` (see DialogueEffects.js); once an NPC's SAN drops
 * far enough they show visible distress, and low enough they go "offline"
 * (给自己请假/下线) - removed from further conversation for the rest of
 * the game and dumping extra workload on the protagonist as a consequence
 * (data-driven via `data/npc_state.json`'s `offlineConsequence`).
 *
 * Thresholds/consequence are entirely data-driven; this module only
 * applies them. Mirrors EndingManager's pattern of importing ItemManager
 * directly to apply a data-described side effect.
 */
class NpcStateManager {
  constructor() {
    this.config = null;
    /** @type {Map<string, number>} actorId -> SAN (0-100) */
    this.san = new Map();
    /** @type {Set<string>} actorIds that have gone offline */
    this.offlineActors = new Set();
    this.npcs = [];
    this._loadPromise = null;
  }

  /** Load `data/npc_state.json` (idempotent, safe to call concurrently). */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        dataLoader.loadJSON("npc_state.json"),
        dataLoader.loadJSON("npcs.json"),
      ]).then(([data, npcDoc]) => {
        this.config = data;
        this.npcs = npcDoc.npcs || [];
        this.npcs.forEach((npc) => {
          if (!this.san.has(npc.id)) {
            const initialSan = Number(npc.initialSan);
            this.san.set(npc.id, Math.max(0, Math.min(100, Number.isFinite(initialSan) ? initialSan : this._defaultSan())));
          }
        });
      });
    }
    return this._loadPromise;
  }

  _defaultSan() {
    return (this.config && Number(this.config.defaultSan)) || 80;
  }

  _distressedThreshold() {
    return (this.config && Number(this.config.distressedThreshold)) || 50;
  }

  _offlineThreshold() {
    return (this.config && Number(this.config.offlineThreshold)) || 20;
  }

  /** Current SAN (0-100) for an actor id; unseen actors start at the configured default. */
  get(actorId) {
    if (!this.san.has(actorId)) {
      const npc = this.npcs.find((entry) => entry.id === actorId);
      const initialSan = Number(npc?.initialSan);
      this.san.set(actorId, Math.max(0, Math.min(100, Number.isFinite(initialSan) ? initialSan : this._defaultSan())));
    }
    return this.san.get(actorId);
  }

  isOffline(actorId) {
    return this.offlineActors.has(actorId);
  }

  /** Visibly shaken/distressed but still willing to talk. */
  isDistressed(actorId) {
    return !this.isOffline(actorId) && this.get(actorId) < this._distressedThreshold();
  }

  /**
   * Adjust an actor's SAN by `delta` (positive or negative). Crossing the
   * offline threshold for the first time triggers `_goOffline` once
   * (idempotent - an NPC can only go offline a single time).
   */
  modify(actorId, delta) {
    if (!actorId || !delta) return;
    const next = clamp(this.get(actorId) + delta);
    this.san.set(actorId, next);
    eventBus.emit("npcState:changed", { actorId, san: next });
    if (next <= this._offlineThreshold() && !this.offlineActors.has(actorId)) {
      this._goOffline(actorId);
    }
  }

  /** Set an actor's SAN directly for developer tools and deterministic probes. */
  setSan(actorId, value, { offline = false } = {}) {
    if (!actorId) return;
    const next = clamp(value);
    this.san.set(actorId, next);
    if (offline) this.offlineActors.add(actorId);
    else this.offlineActors.delete(actorId);
    eventBus.emit("npcState:changed", { actorId, san: next, offline: this.offlineActors.has(actorId), developer: true });
  }

  _goOffline(actorId) {
    this.offlineActors.add(actorId);
    const consequence = (this.config && this.config.offlineConsequence) || {};
    (consequence.grantItems || []).forEach((g) => itemManager.add(g.itemId, g.count || 1));
    if (consequence.actionBudgetPenalty) actionBudget.applyPenalty(consequence.actionBudgetPenalty);
    eventBus.emit("npc:offline", { actorId });
  }

  snapshot() {
    return { san: Object.fromEntries(this.san), offline: [...this.offlineActors] };
  }

  restore({ san = {}, offline = [] } = {}) {
    Object.entries(san).forEach(([id, value]) => {
      if (this.san.has(id) || this.npcs.some((npc) => npc.id === id)) this.san.set(id, Math.max(0, Math.min(100, Number(value) || 0)));
    });
    this.offlineActors = new Set(offline.filter((id) => this.san.has(id)));
    eventBus.emit("npcState:restored", this.snapshot());
  }

  /** Subscribe to any SAN change or offline transition. Returns an unsubscribe function. */
  onChange(handler) {
    const offSan = eventBus.on("npcState:changed", handler);
    const offOffline = eventBus.on("npc:offline", handler);
    return () => {
      offSan();
      offOffline();
    };
  }
}

export const npcStateManager = new NpcStateManager();
export default NpcStateManager;
