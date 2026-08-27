import { dataLoader } from "./DataLoader.js";

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

/**
 * SkillManager - singleton holding the protagonist's skill point values
 * (0-100), used by DiceCheck for CoC-style percentile skill checks (e.g.
 * inspecting an item). Skill defs + starting values are data-driven via
 * `data/skills.json`.
 *
 * Skills do not currently grow during play (no XP/leveling system yet), so
 * SaveManager does not persist them for now - if skill growth is added
 * later this will need a save-format bump (see SaveManager.js).
 */
class SkillManager {
  constructor() {
    /** @type {Map<string, number>} skill id -> 0-100 value */
    this.values = new Map();
    /** @type {Map<string, string>} skill id -> display label */
    this.labels = new Map();
    this._loadPromise = null;
  }

  /** Load `data/skills.json` (idempotent, safe to call concurrently). */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("skills.json").then((data) => {
        (data.skills || []).forEach((s) => {
          if (!s || !s.id) return;
          this.values.set(s.id, clamp(s.value));
          this.labels.set(s.id, s.label || s.id);
        });
      });
    }
    return this._loadPromise;
  }

  /** Current value (0-100) for a skill id. Unknown ids default to 50. */
  get(id) {
    return this.values.has(id) ? this.values.get(id) : 50;
  }

  label(id) {
    return this.labels.get(id) || id;
  }

  all() {
    return [...this.values.keys()].map((id) => ({ id, label: this.label(id), value: this.get(id) }));
  }
}

export const skillManager = new SkillManager();
export default SkillManager;
