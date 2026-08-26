import { windowManager } from "../core/WindowManager.js";
import { gameState } from "../core/GameState.js";
import { itemManager } from "../core/ItemManager.js";
import { eventBus } from "../core/EventBus.js";
import { saveManager } from "../core/SaveManager.js";

/**
 * StatusApp - "状态与属性": the protagonist's stats, inventory, and save/load
 * UI, organized into three tabs:
 *   - 状态: energy/mental/physical/satiety bars + current day/phase.
 *   - 物品: inventory list backed by ItemManager, with 调查/使用 actions.
 *   - 保存: builds/display the save-string URL (SaveManager) and lets the
 *     player load a save string back in.
 * Always available; live-updates via GameState/ItemManager events.
 */
export async function launchStatusApp() {
  await itemManager.load();

  const root = document.createElement("div");
  root.className = "app-status";
  root.innerHTML = `
    <div class="status-tabs">
      <button class="win95-btn bevel-out status-tab-btn" data-tab="stats">状态</button>
      <button class="win95-btn bevel-out status-tab-btn" data-tab="items">物品</button>
      <button class="win95-btn bevel-out status-tab-btn" data-tab="save">保存</button>
    </div>
    <div class="status-tab-panel panel-inset" data-panel="stats"></div>
    <div class="status-tab-panel panel-inset" data-panel="items" hidden></div>
    <div class="status-tab-panel panel-inset" data-panel="save" hidden></div>
  `;

  const tabButtons = [...root.querySelectorAll(".status-tab-btn")];
  const panels = {
    stats: root.querySelector('[data-panel="stats"]'),
    items: root.querySelector('[data-panel="items"]'),
    save: root.querySelector('[data-panel="save"]'),
  };

  function selectTab(name) {
    tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
    Object.entries(panels).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });

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

  function renderStats() {
    const s = gameState.snapshot();
    panels.stats.innerHTML = `
      <h4>主角状态</h4>
      <p>第 ${s.day} 天 · ${s.phase === "day" ? "☀ 白天" : "🌙 夜晚"}</p>
      ${bar("精力", s.energy)}
      ${bar("精神", s.mental)}
      ${bar("体力", s.physical)}
      ${bar("饱腹", s.satiety)}
    `;
  }

  function renderItems() {
    const entries = itemManager.all();
    panels.items.innerHTML = "<h4>持有物品</h4>";
    if (entries.length === 0) {
      panels.items.innerHTML += '<p class="his-empty">（空无一物）</p>';
      return;
    }
    const list = document.createElement("ul");
    list.className = "item-list";
    entries.forEach(({ id, count, def }) => {
      const li = document.createElement("li");
      li.className = "item-row";

      const info = document.createElement("div");
      info.className = "item-row-info";
      info.innerHTML = `<span class="item-row-name">${def.name}</span><span class="item-row-count">x${count}</span>`;
      li.appendChild(info);

      const feedback = document.createElement("p");
      feedback.className = "item-row-feedback";
      feedback.hidden = true;

      const actions = document.createElement("div");
      actions.className = "item-row-actions";

      const inspectBtn = document.createElement("button");
      inspectBtn.className = "win95-btn bevel-out";
      inspectBtn.textContent = "调查";
      inspectBtn.addEventListener("click", () => {
        feedback.hidden = false;
        feedback.textContent = itemManager.inspect(id) || "";
      });
      actions.appendChild(inspectBtn);

      if (def.usable) {
        const useBtn = document.createElement("button");
        useBtn.className = "win95-btn bevel-out";
        useBtn.textContent = "使用";
        useBtn.addEventListener("click", () => {
          const result = itemManager.use(id);
          feedback.hidden = false;
          feedback.textContent = result.message;
        });
        actions.appendChild(useBtn);
      }

      li.appendChild(actions);
      li.appendChild(feedback);
      list.appendChild(li);
    });
    panels.items.appendChild(list);
  }

  function renderSave() {
    panels.save.innerHTML = `
      <h4>保存 / 读取</h4>
      <p>点击“保存”会把当前存档写入地址栏（URL 的 ? 后面部分），请复制该网址保存。</p>
      <button class="win95-btn bevel-out" data-action="save-btn">保存到网址</button>
      <div class="save-url-row">
        <label>存档网址：</label>
        <input type="text" class="win95-input save-url-input" readonly />
      </div>
      <p>粘贴一段存档字符串（? 后面的部分）到下方并点击“读取”即可恢复进度：</p>
      <div class="save-load-row">
        <input type="text" class="win95-input save-load-input" placeholder="粘贴存档字符串" />
        <button class="win95-btn bevel-out" data-action="load-btn">读取</button>
      </div>
      <p class="save-feedback" hidden></p>
    `;
    const urlInput = panels.save.querySelector(".save-url-input");
    const loadInput = panels.save.querySelector(".save-load-input");
    const feedback = panels.save.querySelector(".save-feedback");
    urlInput.value = window.location.href;

    panels.save.querySelector('[data-action="save-btn"]').addEventListener("click", () => {
      const url = saveManager.save();
      urlInput.value = url;
      feedback.hidden = false;
      feedback.textContent = "已保存！请复制上方网址妥善保管。";
    });

    panels.save.querySelector('[data-action="load-btn"]').addEventListener("click", () => {
      const raw = loadInput.value.trim();
      const ok = raw && saveManager.loadFromString(raw.replace(/^\?/, ""));
      feedback.hidden = false;
      feedback.textContent = ok ? "读取成功！" : "读取失败，请检查存档字符串是否正确。";
      if (ok) {
        urlInput.value = window.location.href;
        renderStats();
      }
    });
  }

  function renderAll() {
    renderStats();
    renderItems();
    renderSave();
  }

  const offGameState = eventBus.on("gamestate:changed", renderStats);
  const offDayNight = eventBus.on("daynight:changed", renderStats);
  const offItems = eventBus.on("items:changed", renderItems);

  renderAll();
  selectTab("stats");

  return windowManager.createWindow({
    appId: "status",
    title: "状态与属性",
    icon: "📊",
    width: 380,
    height: 380,
    content: root,
    onClose: () => {
      offGameState();
      offDayNight();
      offItems();
    },
  });
}
