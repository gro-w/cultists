import { OUTCOME_LABELS } from "./DiceCheck.js";
import { keywordManager } from "./KeywordManager.js";

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

/**
 * renderInspectResult - render an `ItemManager.inspect()` result into a
 * container element as interactive HTML:
 *   - `[[keywordId]]` markers in the text become clickable highlighted spans
 *   - dice-check metadata (if present) is appended as a muted line
 *   - `revealKeywordIds` keywords are already collected by ItemManager; inline
 *     keyword spans are NOT auto-collected — the player clicks to collect them
 *
 * Clears the container's existing content before rendering.
 *
 * @param {{ text: string, check: object|null, keywordDefs: object }} result
 * @param {HTMLElement} container
 */
export function renderInspectResult(result, container) {
  if (!result) { container.textContent = ""; return; }

  container.innerHTML = "";

  // Main text paragraph — may contain [[kwId]] markers
  const textEl = document.createElement("p");
  textEl.className = "inspect-text";
  textEl.innerHTML = keywordManager.renderHighlightedText(
    result.text,
    result.keywordDefs || {}
  );
  keywordManager.bindHighlights(textEl, result.keywordDefs || {});
  container.appendChild(textEl);

  // Dice-check metadata line (omit when check is null)
  if (result.check) {
    const { roll, skillValue, outcome } = result.check;
    const label = OUTCOME_LABELS[outcome] || outcome;
    const meta = document.createElement("p");
    meta.className = "inspect-check-meta";
    meta.textContent = `判定：${label}，掷出 ${roll} / 技能 ${skillValue}`;
    container.appendChild(meta);
  }
}
