import { timeService } from "./TimeService.js";
import { activityData } from "./ActivityData.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { modifyStatValue } from "./ActivityValueAccess.js";
import { spellManager } from "./SpellManager.js";
import { spellEffectManager } from "./SpellEffectManager.js";
import { endingManager } from "./EndingManager.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";

/** Domain-side operations used by ActivityRunner, kept out of flow traversal. */
export class ActivityEffectExecutor {
  consumeTime(minutes) { timeService.advanceBy(minutes); }

  setGlobal(id, value, delta) {
    if (delta !== undefined) globalVariableManager.modify(id, delta);
    else globalVariableManager.set(id, value);
  }

  insertActivity(activityId, addTime, queue, options) {
    const result = activityData.addActivity(activityId, addTime, queue, options);
    if (!result.ok) throw new Error(`Insert activity failed: ${result.reason}`);
    return result;
  }

  inventory(itemId, count) {
    if (!Number.isInteger(count)) throw new Error("Inventory operation count must be an integer");
    if (count > 0) itemManager.add(itemId, count);
    else if (count < 0) itemManager.remove(itemId, -count);
    else itemManager.remove(itemId, itemManager.count(itemId));
  }

  stat(statId, delta) { modifyStatValue(statId, delta); }

  spellOperation(spell, requireNew = true) {
    const learned = spellManager.applyLearn(spell);
    if (!learned && requireNew) throw new Error("Spell is already known or invalid");
  }

  cast(spellId, options) {
    const result = spellManager.cast(spellId, options);
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  spellEffect(spellId, options) {
    const spell = spellManager.all().find((item) => item.id === spellId);
    if (!spell) throw new Error("Unknown learned spell");
    return spellEffectManager.handleCast(spell, options);
  }

  ending(endingId) { endingManager.trigger(endingId); }

  submitMedical(patient, diagnosis, medicineIds) {
    const result = medicalCaseManager.submit({ patient, diagnosis, medicineIds });
    if (!result.ok) throw new Error(`Medical submission failed: ${result.reason}`);
    return result;
  }
}

export const activityEffectExecutor = new ActivityEffectExecutor();
export default ActivityEffectExecutor;
