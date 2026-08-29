import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { itemManager } from "./ItemManager.js";
import { mainQueue } from "./ScheduleQueue.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

function clamp(value) {
  return Math.max(0, Math.min(256, Number(value) || 0));
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
    /** @type {Map<string, number>} actorId -> SAN (0-256) */
    this.san = new Map();
    /** @type {Set<string>} actorIds that have gone offline */
    this.offlineActors = new Set();
    this.pendingOfflineActors = new Set();
    this.npcs = [];
    this.indexById = new Map();
    this._loadPromise = null;
    eventBus.on("global-variable:changed", ({ id, value }) => {
      const actorId = id === 5 ? "chatgtp" : id >= 60 && id < 80 ? this.npcs[id - 60]?.id : null;
      if (!actorId) return;
      this.san.set(actorId, value);
      eventBus.emit("npcState:changed", { actorId, san: value });
      if (value <= this._offlineThreshold() && !this.offlineActors.has(actorId) && !this.pendingOfflineActors.has(actorId)) this._goOffline(actorId);
    });
  }

  /** Load `data/npc_state.json` (idempotent, safe to call concurrently). */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        globalVariableManager.init(),
        dataLoader.loadJSON("npc_state.json"),
        dataLoader.loadJSON("npcs.json"),
      ]).then(([, data, npcDoc]) => {
        this.config = data;
        this.npcs = npcDoc.npcs || [];
        this.san.set("chatgtp", globalVariableManager.get(5));
        this.npcs.slice(0, 20).forEach((npc, index) => {
          this.indexById.set(npc.id, index);
          this.san.set(npc.id, globalVariableManager.get(60 + index));
        });
      });
    }
    return this._loadPromise;
  }


  _distressedThreshold() {
    return (this.config && Number(this.config.distressedThreshold)) || 50;
  }

  _offlineThreshold() {
    return (this.config && Number(this.config.offlineThreshold)) || 20;
  }

  /** Current SAN (0-256) for an actor id; unknown actors use a compatibility fallback. */
  get(actorId) {
    const globalId = this._globalIdForActor(actorId);
    if (globalId !== null && globalVariableManager.get(globalId) !== undefined) return globalVariableManager.get(globalId);
    if (!this.san.has(actorId)) {
      this.san.set(actorId, 0);
    }
    return this.san.get(actorId);
  }

  _globalIdForActor(actorId) {
    if (actorId === "chatgtp") return 5;
    const index = this.indexById.get(actorId);
    return index === undefined ? null : 60 + index;
  }

  isOffline(actorId) {
    return this.offlineActors.has(actorId);
  }

  /** Visibly shaken/distressed but still willing to talk. */
  isDistressed(actorId) {
    return !this.isOffline(actorId) && this.get(actorId) < this._distressedThreshold();
  }

  /** Adjust an actor's SAN. Crossing the threshold creates one offline schedule. */
  modify(actorId, delta) {
    if (!actorId || !delta) return;
    const next = clamp(this.get(actorId) + delta);
    const globalId = this._globalIdForActor(actorId);
    if (globalId === null) { this.san.set(actorId, next); eventBus.emit("npcState:changed", { actorId, san: next }); return; }
    globalVariableManager.set(globalId, next);
  }

  /** Set an actor's SAN directly for developer tools and deterministic probes. */
  setSan(actorId, value, { offline = false } = {}) {
    if (!actorId) return;
    const next = clamp(value);
    const globalId = this._globalIdForActor(actorId);
    if (globalId === null) return;
    globalVariableManager.set(globalId, next);
    if (offline) this.offlineActors.add(actorId);
    else this.offlineActors.delete(actorId);
    eventBus.emit("npcState:changed", { actorId, san: next, offline: this.offlineActors.has(actorId), developer: true });
  }

  _goOffline(actorId) {
    this.pendingOfflineActors.add(actorId);
    const consequence = (this.config && this.config.offlineConsequence) || {};
    const entry = {
      id: `npc-offline:${actorId}`,
      scheduleId: `npc-offline:${actorId}`,
      blueprint: consequence.blueprint,
      actorId,
      action: "offline",
      status: "unresolved",
    };
    eventBus.emit("schedule:triggered", {
      source: "npc",
      actorId,
      action: "offline",
      blueprint: consequence.blueprint,
      context: {
        effect: { add: consequence.grantItems || [], npcOffline: [actorId] },
      },
      instance: entry,
    });
  }

  completeOffline(actorId) {
    if (!actorId || this.offlineActors.has(actorId)) return false;
    this.pendingOfflineActors.delete(actorId);
    this.offlineActors.add(actorId);
    eventBus.emit("npcState:changed", { actorId, san: this.get(actorId), offline: true });
    return true;
  }

  snapshot() {
    return {
      san: Object.fromEntries(this.san),
      offline: [...this.offlineActors],
      pendingOffline: [...this.pendingOfflineActors],
    };
  }

  restore({ san = {}, offline = [], pendingOffline = [] } = {}, { useGlobalValues = false } = {}) {
    if (!useGlobalValues) Object.entries(san).forEach(([id, value]) => {
      if (this.san.has(id) || this.npcs.some((npc) => npc.id === id) || id === "chatgtp") {
        const next = Math.max(0, Math.min(256, Number(value) || 0));
        this.san.set(id, next);
        const globalId = this._globalIdForActor(id);
        if (globalId !== null) globalVariableManager.set(globalId, next, { emit: false });
      }
    });
    if (useGlobalValues) this.san.forEach((_, id) => {
      const globalId = this._globalIdForActor(id);
      if (globalId !== null) this.san.set(id, globalVariableManager.get(globalId));
    });
    this.offlineActors = new Set(offline.filter((id) => this.san.has(id)));
    this.pendingOfflineActors = new Set(pendingOffline.filter((id) => this.san.has(id) && !this.offlineActors.has(id)));
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
