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
 * Events consumed by the activity runtime, not here:
 *   "spell:learned"  — emitted by SpellLearnDialog when the player confirms;
 *                      the learning activity charges 240 min before state change.
 */
class SpellManager {
  constructor() {
    /** @type {Array<object>} */
    this.spells = [];
    this.seasideCastDay = null;
  }

  static isSeasideSpell(spell) {
    return spell?.id === "book_innsmouth__0"
      || spell?.id === "book_wangxb__0"
      || spell?.name === "接触深潜者"
      || spell?.name === "接触克苏鲁";
  }

  isSeasideSpell(spell) {
    return SpellManager.isSeasideSpell(spell);
  }

  _validateCast(spellId, context = {}) {
    const spell = this.spells.find((s) => s.id === spellId);
    if (!spell) return { ok: false, message: "未知法术。" };
    if (SpellManager.isSeasideSpell(spell) && context.location !== "seaside") {
      return { ok: false, message: "只有在海边才能施放这个法术。" };
    }
    if (SpellManager.isSeasideSpell(spell) && this.seasideCastDay === gameState.day) {
      return { ok: false, message: "今天已经在海边施放过法术了。" };
    }
    if (gameState.sanity === 0) return { ok: false, message: "理智值已为 0，无法施放法术。" };
    const cost = spell.castSanCost ?? 5;
    if (gameState.sanity < cost) return { ok: false, message: `理智值不足（需要 ${cost} SAN），无法施放。` };
    return { ok: true, spell, cost };
  }

  /**
   * Apply a completed spell-learning activity. Returns false if already known
   * (idempotent so replayed activity nodes cannot duplicate the spell).
   * @param {object} spell  Full spell object as described above.
   * @returns {boolean} true if newly learned, false if already known.
   */
  applyLearn(spell) {
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
  cast(spellId, context = {}) {
    const validation = this._validateCast(spellId, context);
    if (!validation.ok) return validation;
    const { spell, cost } = validation;
    if (SpellManager.isSeasideSpell(spell)) {
      this.seasideCastDay = gameState.day;
      eventBus.emit("spells:changed", this.snapshot());
    }
    eventBus.emit("activity:triggered", {
      source: "spell",
      spell,
      action: "use",
      activityId: `${spell.id}:use`,
      blueprint: spell.useActivity || spell.activities?.use || null,
      context: { ...context, spell, effect: { statChanges: { sanity: -cost } }, timeMinutes: spell.castTimeMinutes || 0 },
    });
    return { ok: true, message: `施放了「${spell.name}」，消耗 ${cost} SAN。` };
  }

  knows(spellId) {
    return this.spells.some((s) => s.id === spellId);
  }

  canCast(spellId, context = {}) {
    return this._validateCast(spellId, context);
  }

  all() {
    return [...this.spells];
  }

  snapshot() {
    return [...this.spells];
  }

  usageSnapshot() {
    return { seasideCastDay: this.seasideCastDay };
  }

  /** Replace the spell list (used by SaveManager restore). */
  restore(spells) {
    this.spells = Array.isArray(spells) ? [...spells] : [];
    eventBus.emit("spells:changed", this.snapshot());
  }

  restoreUsage(snapshot = {}) {
    this.seasideCastDay = Number.isInteger(snapshot.seasideCastDay) ? snapshot.seasideCastDay : null;
  }

  /** Subscribe to any change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("spells:changed", handler);
  }
}

export const spellManager = new SpellManager();
export default SpellManager;
