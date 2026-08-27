import { skillManager } from "./SkillManager.js";

/**
 * DiceCheck - CoC ("Call of Cthulhu")-style percentile skill check helper.
 * Rules used across this project:
 *   - roll <= floor(skillValue / 5)  -> "criticalSuccess" (大成功)
 *   - roll <= skillValue             -> "success" (成功)
 *   - roll >= 96                     -> "criticalFailure" (大失败)
 *   - otherwise                      -> "failure" (失败)
 * (criticalFailure is checked only after success, matching classic CoC
 * fumble-range behaviour: a high enough skill value can roll past 96 and
 * still count as a plain success.)
 *
 * Pure-function helper module (no singleton state), mirroring the style of
 * DialogueEffects.js elsewhere in this codebase.
 */
export function rollPercentile(skillValue) {
  const value = Math.max(0, Math.min(100, Number(skillValue) || 0));
  const roll = 1 + Math.floor(Math.random() * 100); // 1-100
  let outcome;
  if (roll <= Math.floor(value / 5)) outcome = "criticalSuccess";
  else if (roll <= value) outcome = "success";
  else if (roll >= 96) outcome = "criticalFailure";
  else outcome = "failure";
  return { roll, skillValue: value, outcome };
}

/** Roll a check against a named skill (value looked up via SkillManager). */
export function checkSkill(skillId) {
  return rollPercentile(skillManager.get(skillId));
}

export const OUTCOME_LABELS = {
  criticalSuccess: "大成功",
  success: "成功",
  failure: "失败",
  criticalFailure: "大失败",
};

/**
 * resolveOptionNext - shared helper for dialogue OPTIONS (as opposed to
 * ItemManager.inspect()'s item-check flow above): given a dialogue option
 * `{ label, next, check?: {skillId}, outcomes?: {criticalSuccess/success/
 * failure/criticalFailure: nodeId} }`, decides which node to advance to.
 *
 * Options without a `check` behave exactly as before (always go to
 * `option.next`). Options WITH a `check` roll a fresh CoC-style percentile
 * check every time they're clicked and branch via `outcomes[outcome]`,
 * falling back to `option.next` if that particular outcome has no entry -
 * so an author can specify only the outcomes that actually diverge (e.g.
 * just `criticalFailure`) and let everything else fall through to `next`.
 * @param {object} option
 * @returns {{ next: string|null, check: {roll:number, skillValue:number, outcome:string}|null }}
 */
export function resolveOptionNext(option) {
  if (!option || !option.check || !option.check.skillId) {
    return { next: option ? option.next || null : null, check: null };
  }
  const check = checkSkill(option.check.skillId);
  const outcomes = option.outcomes || {};
  const next = outcomes[check.outcome] || option.next || null;
  return { next, check };
}
