import { OUTCOME_LABELS } from "./DiceCheck.js";

/**
 * formatInspectResult - shared UI helper turning an `ItemManager.inspect()`
 * result ({ text, check }) into a single display string. When the item
 * carried an `inspectCheck` (see ItemManager.js), the roll/outcome is
 * appended so the player can see the dice behind the result; plain
 * (check === null) inspections just show the text as-is.
 * @param {{ text: string, check: {roll:number, skillValue:number, outcome:string}|null }} result
 */
export function formatInspectResult(result) {
  if (!result) return "";
  if (!result.check) return result.text;
  const { roll, skillValue, outcome } = result.check;
  const label = OUTCOME_LABELS[outcome] || outcome;
  return `${result.text}\n（判定：${label}，掷出 ${roll} / 技能 ${skillValue}）`;
}
