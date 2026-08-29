import { windowManager } from "../core/WindowManager.js";
import { turtleSoupManager, turtleSoupAnswers } from "../core/TurtleSoupManager.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export async function launchTurtleSoup(puzzleId = "binbin_turtle_01") {
  await turtleSoupManager.load();
  turtleSoupManager.mount();
  const started = turtleSoupManager.startTurtleSoup(puzzleId);
  if (!started.ok) return null;
  const root = document.createElement("div");
  root.style.cssText = "padding:10px;display:flex;flex-direction:column;gap:8px;font-size:13px;max-height:560px;overflow:auto";
  const render = () => {
    const { puzzle, progressDay, questionCount, history, solved } = turtleSoupManager.getProgress();
    if (!puzzle) return;
    const asked = new Set(history.map((item) => item.question_id));
    const remaining = Math.max(0, Number(puzzle.questions_per_day) - questionCount);
    root.innerHTML = `<h3 style="margin:0">彬彬 · ${escapeHtml(puzzle.title)}</h3>
      <div><strong>第 ${progressDay} / ${puzzle.max_days} 天</strong>　今日剩余问题：${remaining}</div>
      <fieldset><legend>汤面</legend><p style="white-space:pre-wrap">${escapeHtml(puzzle.story)}</p></fieldset>
      <p style="margin:0">你可以向彬彬提出是/否问题：</p>
      <div data-questions></div>
      <details><summary>已经问过的问题（${history.length}）</summary><div data-history></div></details>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="win95-btn bevel-out" data-action="guess">猜汤底</button>
        <button class="win95-btn bevel-out" data-action="finish">结束今天</button>
      </div><div data-message></div>`;
    const questions = root.querySelector("[data-questions]");
    puzzle.questions.forEach((question) => {
      const button = document.createElement("button");
      button.className = "win95-btn bevel-out";
      button.disabled = solved || asked.has(question.question_id) || remaining <= 0;
      button.textContent = `${asked.has(question.question_id) ? "✓ " : "？ "}${question.text}`;
      button.title = asked.has(question.question_id) ? "这个问题你已经问过了。" : "提问";
      button.addEventListener("click", () => {
        const result = turtleSoupManager.ask(question.question_id);
        root.querySelector("[data-message]").textContent = result.ok ? `彬彬：${result.answer}` : (result.reason === "duplicate" ? "这个问题你已经问过了。" : "今天的问题次数已经用完。");
        render();
      });
      questions.appendChild(button);
    });
    const historyEl = root.querySelector("[data-history]");
    historyEl.innerHTML = history.length ? history.map((item) => `<p><b>第${item.day}天</b>　${escapeHtml(item.question_text)}<br>彬彬：${turtleSoupAnswers[item.answer]}</p>`).join("") : "<p>暂无记录。</p>";
    root.querySelector("[data-action=guess]").addEventListener("click", () => {
      const answer = window.prompt("请写下你认为的汤底：", "");
      if (answer == null) return;
      const result = turtleSoupManager.guess(answer);
      root.querySelector("[data-message]").textContent = result.message || (result.correct ? "猜中了。" : "还差一点。");
      if (result.correct) render();
    });
    root.querySelector("[data-action=finish]").addEventListener("click", () => { turtleSoupManager.finishDay(); root.querySelector("[data-message]").textContent = "今天先到这里，明天继续。"; render(); });
  };
  render();
  return windowManager.createWindow({ appId: "turtle-soup", title: "彬彬支线——海龟汤", icon: "🐢", width: 560, height: 560, content: root });
}
