import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";

/**
 * SpellManager — singleton holding the protagonist's learned spells.
 *
 * Spell object shape (runtime):
 *   {
 *     id: string,              // "${sourceBookId}__${spellIndex}" — stable for save/load
 *     name: string,
 *     description: string,
 *     learnTimeMinutes: 240,   // fixed by data contract
 *     castSanCost: 5,          // fixed by data contract
 *     sourceBookId: string,    // item id of the book it was learned from
 *     sourceBookName: string,  // display name of that book
 *     spellIndex: number,      // index within the book's spells[] array
 *   }
 *
 * Events emitted:
 *   "spells:changed" — any time the known-spells list changes (learn/restore)
 *   "spell:cast"     — { spell } when a spell is successfully cast
 *
 * Events consumed (via ActionBudget, not here):
 *   "spell:learned"  — emitted by SpellLearnDialog when the player confirms;
 *                      ActionBudget listens to this and charges 240 min.
 */
class SpellManager {
  constructor() {
    /** @type {Array<object>} */
    this.spells = [];
  }

  /**
   * Learn a spell. Returns false if already known (idempotent — the dialog
   * can safely call this without pre-checking).
   * @param {object} spell  Full spell object as described above.
   * @returns {boolean} true if newly learned, false if already known.
   */
  learn(spell) {
    if (!spell || !spell.id) return false;
    if (this.spells.some((s) => s.id === spell.id)) return false;
    this.spells.push({ ...spell });
    eventBus.emit("spells:changed", this.snapshot());
    return true;
  }

  /**
   * Cast a spell, deducting the SAN cost.
   * @param {string} spellId
   * @returns {{ ok: boolean, message: string }}
   */
  cast(spellId) {
    const spell = this.spells.find((s) => s.id === spellId);
    if (!spell) return { ok: false, message: "未知法术。" };
    if (gameState.mental <= 0) {
      return { ok: false, message: "理智值已为 0，无法施放法术。" };
    }
    const cost = spell.castSanCost || 5;
    if (gameState.mental < cost) {
      return { ok: false, message: `理智值不足（需要 ${cost} SAN），无法施放。` };
    }
    eventBus.emit("schedule:triggered", {
      source: "spell",
      spell,
      action: "cast",
      blueprint: spell.useSchedule || spell.schedules?.cast || null,
      context: { spell, effect: { statChanges: { mental: -cost } }, timeMinutes: spell.castTimeMinutes || 0 },
    });
    return { ok: true, message: `施放了「${spell.name}」，消耗 ${cost} SAN。` };
  }

  knows(spellId) {
    return this.spells.some((s) => s.id === spellId);
  }

  all() {
    return [...this.spells];
  }

  snapshot() {
    return [...this.spells];
  }

  /** Replace the spell list (used by SaveManager restore). */
  restore(spells) {
    this.spells = Array.isArray(spells) ? [...spells] : [];
    eventBus.emit("spells:changed", this.snapshot());
  }

  /** Subscribe to any change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("spells:changed", handler);
  }
}

export const spellManager = new SpellManager();
export default SpellManager;
