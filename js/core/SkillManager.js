import { dataLoader } from "./DataLoader.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

function clamp(value) {
  return Math.max(0, Math.min(256, Number(value) || 0));
}

/**
 * SkillManager - singleton holding the protagonist's skill point values
 * (0-256), used by DiceCheck for CoC-style percentile skill checks (e.g.
 * inspecting an item). Skill defs + starting values are data-driven via
 * `data/skills.json`.
 *
 * Skills are initialized from definitions and their current values are part of
 * the global-variable snapshot, so SaveManager persists them through IDs 20-39.
 */
class SkillManager {
  constructor() {
    /** @type {Map<string, number>} skill id -> 0-256 value */
    this.values = new Map();
    /** @type {Map<string, string>} skill id -> display label */
    this.labels = new Map();
    this.indexById = new Map();
    this._loadPromise = null;
  }

  /** Load `data/skills.json` (idempotent, safe to call concurrently). */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([globalVariableManager.init(), dataLoader.loadJSON("skills.json")]).then(([, data]) => {
        (data.skills || []).slice(0, 20).forEach((s, index) => {
          if (!s || !s.id) return;
          this.indexById.set(s.id, index);
          const value = clamp(s.value);
          this.values.set(s.id, value);
          globalVariableManager.set(20 + index, value, { emit: false });
          this.labels.set(s.id, s.label || s.id);
        });
      });
    }
    return this._loadPromise;
  }

  /** Current value (0-100) for a skill id. Unknown ids default to 50. */
  get(id) {
    const index = this.indexById.get(id);
    return index === undefined ? 50 : globalVariableManager.get(20 + index);
  }

  label(id) {
    return this.labels.get(id) || id;
  }

  all() {
    return [...this.indexById.keys()].map((id) => ({ id, label: this.label(id), value: this.get(id) }));
  }
}

export const skillManager = new SkillManager();
export default SkillManager;
