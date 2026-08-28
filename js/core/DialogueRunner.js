import { applyDialogueOnShow } from "./DialogueEffects.js";
import { endingManager } from "./EndingManager.js";
import { eventBus } from "./EventBus.js";
import { resolveOptionNext, OUTCOME_LABELS } from "./DiceCheck.js";
import { gameState } from "./GameState.js";

/**
 * createDialogueRunner - shared driver for walking a single actor's
 * `dialogueTree`, used identically by HISApp, SocialApp, and MonitorApp so
 * the following behave the same everywhere instead of being copy-pasted
 * three times and drifting out of sync:
 *   - CoC-style dice checks on dialogue OPTIONS (`option.check` ->
 *     `resolveOptionNext`, see DiceCheck.js) with the roll/outcome shown
 *     inline before branching;
 *   - applying `onShow.npcSanChange` against the actor's OWN SAN (passing
 *     `actor.id` through to `applyDialogueOnShow`, see NpcStateManager.js);
 *   - emitting `dialogue:turn` on every option click so ActionBudget can
 *     enforce the per-phase dialogue-turn limit (see ActionBudget.js) -
 *     the greet/opening line does NOT count, only actually advancing the
 *     conversation does.
 *
 * DOM rendering stays app-specific (HIS's `<p>`-based transcript vs
 * Social/Monitor's chat bubbles) via the `appendLine` callback the caller
 * provides; this module only owns the tree-walking + side-effect logic.
 *
 * @param {object} opts
 * @param {object} opts.actor - `{ id, name, dialogueTree }`
 * @param {(speaker:'npc'|'player', label:string, text:string) => void} opts.appendLine
 * @param {HTMLElement} opts.optionsEl - container to render option buttons into
 * @param {string} opts.optionBtnClass
 * @param {string} [opts.appId] - forwarded on the emitted `dialogue:turn` event
 * @param {(nodeId:string) => void} [opts.onNodeShown] - e.g. persist to DialogueProgress
 * @param {() => void} [opts.onComplete] - called when the dialogue reaches a leaf node
 * @param {string} [opts.emptyMessage] - shown (as an npc line) when the actor has no dialogueTree
 */
export function createDialogueRunner({
  actor,
  appendLine,
  optionsEl,
  optionBtnClass,
  appId,
  onNodeShown,
  onComplete,
  emptyMessage = "（暂无对话内容）",
}) {
  const stateActorId = actor.npcId || actor.id;
  function showNode(nodeId) {
    const tree = actor.dialogueTree;
    const node = nodeId ? tree && tree.nodes[nodeId] : null;
    optionsEl.innerHTML = "";
    if (!node) {
      if (!tree) appendLine("npc", actor.name, emptyMessage);
      return;
    }
    if (onNodeShown) onNodeShown(nodeId);

    // Emit game:text_read so AchievementManager can track "read all texts".
    // Uses a stable composite key: actorId + "/" + nodeId.
    eventBus.emit("game:text_read", { nodeId: `${actor.id}/${nodeId}` });

    appendLine(node.speaker, node.speaker === "npc" ? actor.name : "我", node.text);
    applyDialogueOnShow(node, stateActorId);
    if (endingManager.isEnded) return;

    if (node.options && node.options.length > 0) {
      node.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = optionBtnClass;
        btn.textContent = opt.label;
        btn.addEventListener("click", () => {
          eventBus.emit("dialogue:turn", { appId, actorId: actor.id });
          appendLine("player", "我", opt.label);
          const { next, check } = resolveOptionNext(opt);
          if (check) {
            const outcomeLabel = OUTCOME_LABELS[check.outcome] || check.outcome;
            appendLine(
              "npc",
              "（判定）",
              `${outcomeLabel}（掷出 ${check.roll} / 技能 ${check.skillValue}）`
            );
            // Emit game:skill_check so AchievementManager can react.
            eventBus.emit("game:skill_check", {
              skillId: opt.check && opt.check.skillId,
              roll: check.roll,
              skillValue: check.skillValue,
              outcome: check.outcome,
              actorId: actor.id,
              appId,
            });
            // Also forward SAN-change info if the game state just changed
            // (outcome-based statChanges are handled via onShow, not here,
            //  but we still want the pre/post SAN delta for "精神内耗").
            const snap = gameState.snapshot();
            if (typeof snap.mental === "number") {
              // The delta will have been applied already by applyDialogueOnShow
              // if the node had statChanges; we emit with current mental so
              // the achievement manager has an up-to-date value.
              eventBus.emit("game:sanity_changed", {
                value: snap.mental,
                delta: 0, // delta unknown here; stat-change nodes emit their own
              });
            }
          }
          showNode(next);
        });
        optionsEl.appendChild(btn);
      });
    } else {
      optionsEl.innerHTML = '<p class="dialogue-end">（对话已结束）</p>';
      if (onComplete) onComplete();
    }
  }

  return { showNode };
}
