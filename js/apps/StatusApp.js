import { windowManager } from "../core/WindowManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";

/**
 * StatusApp - displays the protagonist's current status: energy,
 * mental/physical condition, current day and day/night phase.
 * Always available, and live-updates via GameState events.
 */
export async function launchStatusApp() {
  const root = document.createElement("div");
  root.className = "app-status";

  function bar(label, value) {
    return `
      <div class="status-row">
        <span class="status-label">${label}</span>
        <div class="status-bar bevel-in">
          <div class="status-bar-fill" style="width:${value}%"></div>
        </div>
        <span class="status-value">${value}</span>
      </div>
    `;
  }

  function render() {
    const s = gameState.snapshot();
    root.innerHTML = `
      <h4>主角状态</h4>
      <p>第 ${s.day} 天 · ${s.phase === "day" ? "☀ 白天" : "🌙 夜晚"}</p>
      ${bar("精力", s.energy)}
      ${bar("精神", s.mental)}
      ${bar("体力", s.physical)}
    `;
  }

  const offGameState = eventBus.on("gamestate:changed", render);
  const offDayNight = eventBus.on("daynight:changed", render);
  render();

  return windowManager.createWindow({
    appId: "status",
    title: "状态显示器",
    icon: "📊",
    width: 320,
    height: 260,
    resizable: false,
    content: root,
    onClose: () => {
      offGameState();
      offDayNight();
    },
  });
}
