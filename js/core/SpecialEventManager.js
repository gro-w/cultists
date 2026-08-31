import { dataLoader } from "./DataLoader.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function inRange(value, min, max) {
  return (min == null || value >= Number(min)) && (max == null || value <= Number(max));
}

/**
 * SpecialEventManager - resolves NPC events that temporarily replace the
 * matching actor in a normal day-phase activity. Events are data-only and
 * become active when their day/phase and NPC value conditions all match.
 *
 * Event shape:
 * {
 *   id, npcId, phase: "day"|"night", startDay, endDay,
 *   favorability: { min, max }, san: { min, max },
 *   dialogueTree: { start, nodes }
 * }
 */
class SpecialEventManager {
  constructor() {
    this.events = [];
    this.npcs = [];
    this._loadPromise = null;
  }

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        dataLoader.loadJSON("special_events.json"),
        dataLoader.loadJSON("npcs.json"),
      ]).then(([events, npcDoc]) => {
        this.events = events.events || [];
        this.npcs = npcDoc.npcs || [];
      });
    }
    return this._loadPromise;
  }

  npc(id) {
    return this.npcs.find((npc) => npc.id === id) || null;
  }

  matches(event, day, phase, actor) {
    if (!event || event.phase !== phase || event.npcId !== (actor.npcId || actor.id)) return false;
    if (!inRange(day, event.startDay, event.endDay)) return false;
    const favorability = favorabilityManager.get(event.npcId);
    const san = npcStateManager.get(event.npcId);
    return inRange(favorability, event.favorability?.min, event.favorability?.max)
      && inRange(san, event.san?.min, event.san?.max)
      && globalVariableManager.matches(event.condition || event.globalVariableCondition);
  }

  eventFor(day, phase, actor) {
    return this.events.find((event) => this.matches(event, day, phase, actor)) || null;
  }

  /** Return a fresh activity copy with matching NPC actors replaced. */
  apply(activity, day, phase) {
    const result = clone(activity) || {};
    ["patients", "contacts"].forEach((listKey) => {
      result[listKey] = (result[listKey] || []).map((actor) => {
        const npc = this.npc(actor.npcId);
        const event = this.eventFor(day, phase, actor);
        if (!event && !npc) return actor;
        return {
          ...actor,
          ...(npc ? { name: npc.name, avatar: npc.avatar || actor.avatar } : {}),
          ...(event ? {
            npcId: event.npcId,
            dialogueTree: clone(event.dialogueTree),
            blueprint: clone(event.blueprint || event.dialogueTree),
          } : {}),
        };
      });
    });
    return result;
  }
}

export const specialEventManager = new SpecialEventManager();
export default SpecialEventManager;
