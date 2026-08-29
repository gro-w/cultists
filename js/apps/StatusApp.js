import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { gameState } from "../core/GameState.js";
import { itemManager } from "../core/ItemManager.js";
import { eventBus } from "../core/EventBus.js";
import { saveManager } from "../core/SaveManager.js";
import { skillManager } from "../core/SkillManager.js";
import { timeService } from "../core/TimeService.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { formatInspectResult, renderInspectResult } from "../core/InspectFormat.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { medicalCaseManager } from "../core/MedicalCaseManager.js";

/**
 * StatusApp - "状态与属性": the protagonist's stats, inventory, and save/load
 * UI, organized into four tabs:
 *   - 状态: energy/mental/physical/satiety bars + current day/phase, plus
 *     this phase's elapsed time (TimeService) and the
 *     protagonist's skill values (SkillManager, used by dice checks).
 *   - 物品: inventory list backed by ItemManager, with 调查/使用 actions.
 *     Inspecting an item with a configured `inspectCheck` re-rolls a dice
 *     check every time (see ItemManager.inspect()/InspectFormat.js), so
 *     repeated inspections can surface different results.
 *   - NPC: every patient/contact/ChatGTP the player has interacted with,
 *     and their own SAN (NpcStateManager) - distressed/offline status is
 *     shown here at a glance instead of only inside each app.
 *   - 保存: downloads a save file (SaveManager) and lets the player select
 *     a save file to restore.
 * Always available; live-updates via GameState/ItemManager/TimeService/
 * NpcStateManager events.
 */
export async function launchStatusApp() {
  await itemManager.load();

  const root = document.createElement("div");
  root.className = "app-status";
  root.innerHTML = `
    <div class="status-tabs">
      <button class="win95-btn bevel-out status-tab-btn" data-tab="stats">状态</button>
      <button class="win95-btn bevel-out status-tab-btn" data-tab="items">物品</button>
      <button class="win95-btn bevel-out status-tab-btn" data-tab="npc">NPC</button>
      <button class="win95-btn bevel-out status-tab-btn" data-tab="save">保存</button>
    </div>
    <div class="status-tab-panel panel-inset" data-panel="stats"></div>
    <div class="status-tab-panel panel-inset" data-panel="items" hidden></div>
    <div class="status-tab-panel panel-inset" data-panel="npc" hidden></div>
    <div class="status-tab-panel panel-inset" data-panel="save" hidden></div>
  `;

  const tabButtons = [...root.querySelectorAll(".status-tab-btn")];
  const panels = {
    stats: root.querySelector('[data-panel="stats"]'),
    items: root.querySelector('[data-panel="items"]'),
    npc: root.querySelector('[data-panel="npc"]'),
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
    const budgetSnapshot = timeService.snapshot();
    const { phaseMinutes } = budgetSnapshot;
    const phaseLimit = s.phase === "day"
      ? timeService.config?.day?.workMinutes || 480
      : timeService.config?.night?.nightMinutes || 960;
    const clockMinutes = (s.phase === "day" ? 8 * 60 : 16 * 60) + phaseMinutes;
    const clock = `${String(Math.floor((clockMinutes % 1440) / 60)).padStart(2, "0")}:${String(clockMinutes % 60).padStart(2, "0")}`;
    panels.stats.innerHTML = `
      <h4>主角状态</h4>
      <p>第 ${s.day} 天 · ${dayNightSystem.isDaylight() ? "☀ 白天" : "🌙 夜晚"} · ${s.location === "dorm" ? "宿舍" : "工作中"} · ${clock}</p>
      ${bar("理智", s.sanity)}
      <p class="action-budget-row">室友怀疑度：${s.roommateSuspicion} / 100</p>
      <p class="action-budget-row">时间：${Math.floor(phaseMinutes / 60)} 小时 ${phaseMinutes % 60} 分 / ${phaseLimit / 60} 小时${phaseMinutes > phaseLimit ? "（已进入加班/熬夜）" : ""}</p>
      <p class="income-row">当前收入：${medicalCaseManager.income} 元</p>

      <h4>技能</h4>
      ${skillManager
        .all()
        .map((sk) => `<p class="skill-row">${sk.label}：${sk.value}</p>`)
        .join("")}
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

      const feedback = document.createElement("div");
      feedback.className = "item-row-feedback";
      feedback.hidden = true;

      const actions = document.createElement("div");
      actions.className = "item-row-actions";

      const inspectBtn = document.createElement("button");
      inspectBtn.className = "win95-btn bevel-out";
      // Items with a dice-check inspection are explicitly re-inspectable
      // (see ItemManager.inspect()); plain items just show the same text
      // every time, so the label stays "调查" for those.
      inspectBtn.textContent = def.inspectCheck ? "调查（可重复）" : "调查";
      inspectBtn.addEventListener("click", () => {
        const result = itemManager.inspect(id);
        feedback.hidden = false;
        renderInspectResult(result, feedback);
      });
      actions.appendChild(inspectBtn);

      if (itemManager.hasAnyImage(id)) {
        const imgBtn = document.createElement("button");
        imgBtn.className = "win95-btn bevel-out";
        imgBtn.textContent = "外观";
        imgBtn.addEventListener("click", () => {
          const src = itemManager.getImage(id);
          if (!src) {
            feedback.hidden = false;
            feedback.innerHTML = `<span style="color:#888;font-size:12px">（当前 SAN 段没有外观图片）</span>`;
            return;
          }
          // Toggle: if already showing this image, close it
          const existing = feedback.querySelector(".item-image-preview");
          if (!feedback.hidden && existing) {
            feedback.hidden = true;
            feedback.innerHTML = "";
            return;
          }
          feedback.hidden = false;
          feedback.innerHTML = `<img class="item-image-preview" src="${src}" alt="${def.name}" title="${def.name}">`;
        });
        actions.appendChild(imgBtn);
      }

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

  function renderNpcStates() {
    const entries = [...npcStateManager.san.keys()];
    panels.npc.innerHTML = "<h4>已接触的 NPC 状态</h4>";
    if (entries.length === 0) {
      panels.npc.innerHTML += '<p class="his-empty">（尚未与任何人产生足够互动）</p>';
      return;
    }
    const list = document.createElement("ul");
    list.className = "item-list";
    entries.forEach((actorId) => {
      const san = npcStateManager.get(actorId);
      const offline = npcStateManager.isOffline(actorId);
      const distressed = !offline && npcStateManager.isDistressed(actorId);
      const li = document.createElement("li");
      li.className = "item-row";
      li.innerHTML = `
        <div class="item-row-info">
          <span class="item-row-name">${actorId}${offline ? " 🚫" : distressed ? " ⚠️" : ""}</span>
          <span class="item-row-count">SAN ${san}</span>
        </div>
        <div class="status-bar bevel-in npc-san-bar">
          <div class="status-bar-fill${offline ? " offline" : distressed ? " distressed" : ""}" style="width:${san}%"></div>
        </div>
      `;
      list.appendChild(li);
    });
    panels.npc.appendChild(list);
  }

  function renderSave() {
    panels.save.innerHTML = `
      <h4>保存 / 读取</h4>
      <p>点击“下载存档”将当前进度保存为文件，请妥善保管该文件。</p>
      <button class="win95-btn bevel-out" data-action="save-btn">下载存档文件</button>
      <p>选择之前下载的存档文件即可恢复进度：</p>
      <div class="save-load-row">
        <input type="file" class="win95-input save-file-input" accept=".sav,application/octet-stream" />
        <button class="win95-btn bevel-out" data-action="load-btn">载入文件</button>
      </div>
      <p class="save-feedback" hidden></p>
    `;
    const loadInput = panels.save.querySelector(".save-file-input");
    const feedback = panels.save.querySelector(".save-feedback");
    panels.save.querySelector('[data-action="save-btn"]').addEventListener("click", () => {
      const fileName = saveManager.saveToFile();
      feedback.hidden = false;
      feedback.textContent = `已下载 ${fileName}，请妥善保管。`;
    });

    panels.save.querySelector('[data-action="load-btn"]').addEventListener("click", async () => {
      const ok = await saveManager.loadFromFile(loadInput.files[0]);
      feedback.hidden = false;
      feedback.textContent = ok ? "读取成功！" : "读取失败，请检查存档文件是否有效或版本是否受支持。";
      if (ok) {
        renderAll();
      }
    });
  }

  function renderAll() {
    renderStats();
    renderItems();
    renderNpcStates();
    renderSave();
  }

  const offGameState = eventBus.on("gamestate:changed", renderStats);
  const offDayNight = eventBus.on("daynight:changed", renderStats);
  const offMedicalIncome = eventBus.on("medical:incomeChanged", renderStats);
  const offItems = eventBus.on("items:changed", renderItems);
  const offBudget = timeService.onChange(renderStats);
  const offNpcState = npcStateManager.onChange(renderNpcStates);

  renderAll();
  selectTab("stats");

  return windowManager.createWindow({
    appId: "status",
    title: i18n.t("apps.status", "状态与属性"),
    icon: "📊",
    width: 400,
    height: 440,
    content: root,
    onClose: () => {
      offGameState();
      offDayNight();
      offMedicalIncome();
      offItems();
      offBudget();
      offNpcState();
    },
  });
}
