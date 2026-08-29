// DEV-TOOLS:START
import { windowManager } from "../core/WindowManager.js";
import { dataLoader, detectDevServer, writeJSONToDisk } from "../core/DataLoader.js";
import { scheduleData } from "../core/ScheduleData.js";
import { MAX_GAME_DAYS } from "../core/GameRules.js";
import { saveManager } from "../core/SaveManager.js";
import { gameState } from "../core/GameState.js";
import { timeService } from "../core/TimeService.js";
import { itemManager } from "../core/ItemManager.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { eventBus } from "../core/EventBus.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { favorabilityManager } from "../core/FavorabilityManager.js";
import { dialogueProgress } from "../core/DialogueProgress.js";
import { globalVariableManager } from "../core/GlobalVariableManager.js";
import { itemPlacementManager } from "../core/ItemPlacementManager.js";
import { medicalCaseManager } from "../core/MedicalCaseManager.js";
import { endingManager } from "../core/EndingManager.js";
import { spellManager } from "../core/SpellManager.js";
import { keywordManager } from "../core/KeywordManager.js";
import { achievementManager } from "../core/AchievementManager.js";
import { workQueue, socialQueue, chatgtpQueue, realtimeQueue } from "../core/ScheduleQueue.js";
import { normalizeBlueprint } from "../core/ScheduleBlueprint.js";
import { DevItemEditorTab } from "./DevItemEditorTab.js";
import { DevDialogueEditorTab } from "./DevDialogueEditorTab.js";
import { DevBgmEditorTab } from "./DevBgmEditorTab.js";
import { DevLocationEditorTab } from "./DevLocationEditorTab.js";
import { DevDormComputerTab } from "./DevDormComputerTab.js";
import { DEDICATED_EDITOR_CLASSES } from "./DevDedicatedDataEditors.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const DAY_FILES = () => Array.from({ length: Math.min(MAX_GAME_DAYS, scheduleData.totalDays) }, (_, i) => ["work", "social"].flatMap((queue) => [`${queue}${String(i + 1).padStart(2, "0")}a.json`, `${queue}${String(i + 1).padStart(2, "0")}b.json`])).flat();

const QA_PAGE_SIZE = 50;
const SCHEDULE_CATEGORIES = { calendar: "日历日程", public: "公共日程", special: "特殊事件日程", ending: "结局日程", embedded: "物品与法术内嵌日程" };
const KEYWORD_CATEGORY_LABELS = {
  disease: "疾病",
  "disease-category": "疾病类别",
  symptom: "症状",
  medicine: "药品",
  "medicine-category": "药品类别",
  misc: "其他",
};
function keywordCategory(keyword) {
  const id = String(keyword?.id || "");
  if (id.startsWith("disease-category:")) return "disease-category";
  if (id.startsWith("disease:")) return "disease";
  if (id.startsWith("medicine-category:")) return "medicine-category";
  if (id.startsWith("symptom_")) return "symptom";
  if (id.startsWith("med_") || id === "med_paracetamol" || id === "med_cough_syrup") return "medicine";
  return "misc";
}
const button = (text, action, className = "") => `<button type="button" class="win95-btn dev-btn ${className}" data-dev-action="${action}">${text}</button>`;
const DEDICATED_EDITOR_TITLES = {
  "chatgtp-dialog": "ChatGTP 对话编辑器", "item-placements": "场景物品摆放编辑器", diagnoses: "诊断知识编辑器",
  medicines: "药品知识编辑器", "medical-events": "医疗事件编辑器", "npc-state": "NPC 状态规则编辑器",
  "time-rules": "时间规则编辑器", calendar: "日历规则编辑器", achievements: "成就定义编辑器",
  skills: "技能定义编辑器", "monitor-scenes": "监控场景编辑器",
};
const DEV_EDITOR_ICONS = {
  "tab-keywords": "🔑", "tab-chatgtp": "🤖", "tab-npcs": "👥", "tab-global-variables": "🔢",
  "tab-item-editor": "📦", "tab-dialogue-editor": "📅", "tab-bgm-editor": "🎵", "tab-location-editor": "📍",
  "tab-dorm-computer": "💻", "tab-state": "🕒", "tab-npc-state": "👤", "tab-inventory": "🎒",
  "tab-schedules": "📋", "tab-world": "🌐", "tab-medical-ending": "⚕️",
};
function downloadJson(fileName, value) { const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); }
function clockParts() { const total = dayNightSystem.currentClockMinutes(); return { total, hour: Math.floor(total / 60), minute: total % 60 }; }
function phaseForClock(total) { const normalized = ((total % 1440) + 1440) % 1440; return normalized >= 480 && normalized < 960 ? { phase: "day", phaseMinutes: normalized - 480 } : { phase: "night", phaseMinutes: normalized >= 960 ? normalized - 960 : normalized + 480 }; }
function scheduleNodeContent(node) {
  if (!node) return "";
  if (node.type === "text") return node.inputs?.text ?? node.text ?? "";
  if (node.type === "choice") return "选项节点";
  if (node.type === "scheduleEnd") return "日程结束";
  if (node.type === "flowStart") return "流程开始";
  return node.label || node.type || "流程节点";
}
function scheduleNodeOptions(entry) {
  const blueprint = normalizeBlueprint(entry.payload?.blueprint || entry.payload || entry);
  return Object.values(blueprint.nodes || {}).map((node) => `<option value="${esc(node.id)}" ${node.id === (entry.currentNodeId || blueprint.startNodeId) ? "selected" : ""}>${esc(node.id)}：${esc(scheduleNodeContent(node))}</option>`).join("");
}

export function launchDatabaseApp() {
  eventBus.emit("developer:opened", { appId: "developer-mode" });
  const existing = windowManager.getByAppId("developer-mode");
  if (existing) { windowManager.focus(existing.id); return; }
  const root = document.createElement("div"); root.className = "developer-mode-root";
  const win = windowManager.createWindow({ appId: "developer-mode", title: "开发人员模式", icon: "🛠️", width: 900, height: 680, content: root });
  const mode = new DeveloperMode(root, win);
  // Probe for dev-server in the background; update UI when we know.
  detectDevServer().then((active) => {
    mode.setDevServer(active);
    if (active) mode.connectSSE();
  });
}

// Backwards-compatible source entry for external developer tooling.
export const launchDeveloperMode = launchDatabaseApp;

export class DeveloperMode {
  constructor(root, win, renderShell = true) { this.root = root; this.win = win; this.docs = new Map(); this.qaDraft = null; this.qaPage = 1; this.qaCategory = ""; this._devServerActive = false; this._sse = null; this._itemEditorTab = null; this._dialogueEditorTab = null; this._bgmEditorTab = null; this._locationEditorTab = null; this._dormComputerTab = null; this._structuredEditorTab = null; this._activeRuntimeMethod = null; this._runtimeRefreshQueued = false; this._runtimeUnsubs = []; this._bindRuntimeRefresh(); if (renderShell) this.render(); }
  _bindRuntimeRefresh() {
    const events = ["time:changed", "gamestate:changed", "daynight:changed", "day:settled", "schedule:appended", "schedule:changed", "schedule:resolved", "schedule:completed", "items:changed", "item-placements:changed", "keyword:collected", "keyword:new", "keyword:removed", "spells:changed", "npcState:changed", "favorability:changed", "dialogueProgress:changed", "dialogueProgress:restored", "global-variable:changed", "global-variables:changed", "medical:submitted", "medical:incident", "medical:incomeChanged", "ending:triggered", "ending:restored", "ending:reset", "achievement:unlocked", "achievements:reset"];
    events.push("npcState:restored", "favorability:restored", "global-variables:restored", "medical:restored");
    events.forEach((event) => this._runtimeUnsubs.push(eventBus.on(event, () => this._queueRuntimeRefresh())));
    this.win?.element?.addEventListener("remove", () => {
      this._runtimeUnsubs.forEach((unsubscribe) => unsubscribe());
      this._runtimeUnsubs = [];
    }, { once: true });
  }
  _queueRuntimeRefresh() {
    if (!this._activeRuntimeMethod || this._runtimeRefreshQueued) return;
    this._runtimeRefreshQueued = true;
    queueMicrotask(() => {
      this._runtimeRefreshQueued = false;
      if (this._activeRuntimeMethod && typeof this[this._activeRuntimeMethod] === "function") this[this._activeRuntimeMethod]();
    });
  }
  render() {
    const icon = (label, iconText, action, kind) => `<div class="dev-app-icon ${kind === "data" ? "dev-app-icon-data" : kind === "runtime" ? "dev-app-icon-runtime" : "dev-app-icon-mature"}" data-dev-dblclick="open-editor" data-editor-action="${action}" data-editor-title="${label}" data-editor-kind="${kind}" tabindex="0"><span class="dev-app-icon-glyph">${iconText}</span><span>${label}</span></div>`;
    const matureActions = new Set(["tab-keywords", "tab-chatgtp", "tab-npcs", "tab-global-variables", "tab-dialogue-editor", "tab-bgm-editor", "tab-location-editor", "tab-dorm-computer"]);
    const dataIcons = [
      ["关键词编辑器", "🔑", "tab-keywords"], ["ChatGTP 问答", "🤖", "tab-chatgtp"], ["NPC 列表", "👥", "tab-npcs"], ["全局变量定义", "🔢", "tab-global-variables"],
      ["物品与法术编辑器", "📦", "tab-item-editor"], ["日程编辑器", "📅", "tab-dialogue-editor"], ["BGM 编辑器", "🎵", "tab-bgm-editor"], ["位置编辑器", "📍", "tab-location-editor"], ["电脑内容", "💻", "tab-dorm-computer"],
      ...Object.keys(DEDICATED_EDITOR_CLASSES).map((key) => [DEDICATED_EDITOR_TITLES[key], "🗃️", `tab-structured-${key}`]),
    ];
    const runtimeIcons = [["时间与读档", "🕒", "tab-state"], ["玩家与资源", "🎒", "tab-inventory"], ["NPC与对话", "👤", "tab-npc-state"], ["日程与队列", "📋", "tab-schedules"], ["世界与场景", "🌐", "tab-world"], ["医疗与结局", "⚕️", "tab-medical-ending"]];
    this.root.innerHTML = `<section class="dev-app-section dev-database-section"><div class="dev-app-heading"><strong>数据库 App</strong><span>静态数据编辑器。蓝色表示仍在开发，灰色表示较为成熟；双击图标在新窗口打开。</span></div><div class="dev-app-grid">${dataIcons.map(([label, glyph, action]) => icon(label, glyph, action, matureActions.has(action) ? "mature" : "data")).join("")}</div></section><section class="dev-app-section dev-debugger-section"><div class="dev-app-heading dev-runtime-heading"><strong>调试器</strong><span>观察或修改当前游戏运行时变量。双击图标在新窗口打开。</span></div><div class="dev-app-grid">${runtimeIcons.map(([label, glyph, action]) => icon(label, glyph, action, "runtime")).join("")}</div></section><div class="dev-status" data-dev-status>开发人员模式就绪。</div>`;
    this.bindPanel();
  }

  /** Called once detectDevServer() resolves. Updates status bar. */
  setDevServer(active) {
    this._devServerActive = active;
    if (active) this.setStatus("✅ 开发服务器已连接 — 「写入磁盘」按钮已启用。");
  }

  /** Open SSE connection; clears DataLoader cache on file-changed events. */
  connectSSE() {
    if (this._sse) return;
    const es = new EventSource("/api/events");
    this._sse = es;
    es.addEventListener("file-changed", (e) => {
      try { const { filename } = JSON.parse(e.data); dataLoader.clearCache(filename); this.setStatus(`📂 磁盘文件已变更：${filename}（缓存已清除）`); } catch (_) { /* ignore */ }
    });
    es.onerror = () => { this.setStatus("⚠️ SSE 连接中断，磁盘变更通知已停止。", true); };
    this.win.element?.addEventListener("remove", () => { es.close(); this._sse = null; }, { once: true });
  }

  /** Write a validated doc to disk via the dev-server API. Returns true on success. */
  async writeToDisk(filename, value) {
    if (!this._devServerActive) { this.setStatus("未检测到开发服务器，无法写入磁盘。请用「下载」按钮代替。", true); return false; }
    try { await writeJSONToDisk(filename, value); this.setStatus(`✅ ${filename} 已写入磁盘。`); return true; }
    catch (err) { this.setStatus(`✗ 写入磁盘失败：${err.message}`, true); return false; }
  }

  setStatus(message, error = false) {
    const el = this.root.querySelector("[data-dev-status]");
    el.textContent = message;
    el.classList.toggle("dev-error", error);
  }

  downloadFile(fileName, value) { downloadJson(fileName, value); }

  bindPanel() {
    this.root.querySelectorAll("[data-dev-action]").forEach((el) => {
      if (el.dataset.devBound) return;
      el.dataset.devBound = "1";
      el.addEventListener("click", () => this.handle(el.dataset.devAction, el));
    });
    this.root.querySelectorAll("[data-dev-dblclick]").forEach((el) => {
      if (el.dataset.devBound) return;
      el.dataset.devBound = "1";
      el.addEventListener("dblclick", () => this.handle(el.dataset.devDblclick, el));
    });
  }
  async openEditorWindow(action, title, kind) {
    const appId = `developer-editor-${action}`;
    const existing = windowManager.getByAppId(appId);
    if (existing) { windowManager.focus(existing.id); return; }
    const root = document.createElement("div"); root.className = "developer-mode-root";
    const icon = DEV_EDITOR_ICONS[action] || (action.startsWith("tab-structured-") ? "🗃️" : kind === "data" ? "🗄️" : "🐞");
    const win = windowManager.createWindow({ appId, title, icon, width: kind === "data" ? 900 : 820, height: kind === "data" ? 680 : 620, content: root });
    const editor = new DeveloperMode(root, win, false);
    root.innerHTML = `<div class="dev-editor-window-heading"><strong>${esc(title)}</strong><span>${kind === "data" ? "数据库 App" : "调试器"}</span></div><div class="dev-status" data-dev-status>正在加载…</div><div class="dev-panel" data-dev-panel></div>`;
    win.element?.addEventListener("remove", () => editor._unmountEditorTabs(), { once: true });
    const methods = { "tab-keywords": "showKeywords", "tab-chatgtp": "showChatgtp", "tab-npcs": "showNpcs", "tab-global-variables": "showGlobalVariables", "tab-item-editor": "showItemEditor", "tab-dialogue-editor": "showDialogueEditor", "tab-bgm-editor": "showBgmEditor", "tab-location-editor": "showLocationEditor", "tab-dorm-computer": "showDormComputerEditor", "tab-state": "showState", "tab-npc-state": "showNpcState", "tab-inventory": "showInventory", "tab-schedules": "showSchedules", "tab-world": "showWorld", "tab-medical-ending": "showMedicalEnding" };
    if (methods[action]) { editor._unmountEditorTabs(); editor[methods[action]](); return; }
    const structured = action.match(/^tab-structured-(.+)$/);
    if (structured) return editor.showStructuredEditor(structured[1]);
  }
  openTemporaryScheduleEditor() {
    const host = document.createElement("div");
    const queueId = "social";
    const child = new DevDialogueEditorTab(this, { workspace: false, temporaryScope: {
      onSave: (blueprint) => {
        const result = scheduleData.createTemporaryInstance(blueprint, queueId);
        this.setStatus(result.ok ? `临时日程已插入 ${queueId} 队列。` : "临时日程插入失败。", !result.ok);
        return result;
      },
    } });
    const win = windowManager.createWindow({ title: "临时日程编辑器", icon: "🧩", width: Math.max(500, window.innerWidth - 20), height: Math.max(300, window.innerHeight - 20), x: 0, y: 0, content: host, onClose: () => child.unmount() });
    win.el?.classList.add("dev-blueprint-window");
    host.innerHTML = child.html(); child.mount(host.querySelector(".dev-de-root"));
    win.el?.addEventListener("remove", () => child.unmount(), { once: true });
  }
  _setPanelKind(kind) {
    const panel = this.root.querySelector("[data-dev-panel]");
    if (!panel) return;
    panel.classList.toggle("dev-data-panel", kind === "data");
    panel.classList.toggle("dev-runtime-panel", kind !== "data");
  }
  panel(html, kind = "runtime") {
    const panel = this.root.querySelector("[data-dev-panel]");
    this._setPanelKind(kind);
    panel.innerHTML = html;
    this.bindPanel();

  }

  /** Unmount any active editor tab (item / dialogue / bgm / location / dormComputer) before switching panels. */
  _unmountEditorTabs() {
    if (this._dialogueEditorTab) { this._dialogueEditorTab.unmount(); this._dialogueEditorTab = null; }
    if (this._bgmEditorTab) { this._bgmEditorTab.unmount(); this._bgmEditorTab = null; }
    if (this._locationEditorTab) { this._locationEditorTab.unmount(); this._locationEditorTab = null; }
    if (this._dormComputerTab) { this._dormComputerTab.unmount(); this._dormComputerTab = null; }
    if (this._structuredEditorTab) { this._structuredEditorTab.unmount(); this._structuredEditorTab = null; }
    // item editor has no document-level listeners, no explicit unmount needed
    this._itemEditorTab = null;
  }

  showItemEditor() {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    this._itemEditorTab = new DevItemEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._itemEditorTab.html();
    this.bindPanel();
    this._itemEditorTab.mount();
  }

  showDialogueEditor() {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    this._dialogueEditorTab = new DevDialogueEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._dialogueEditorTab.html();
    this.bindPanel();
    this._dialogueEditorTab.mount(this.root.querySelector(".dev-de-root"));
  }

  showBgmEditor() {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    this._bgmEditorTab = new DevBgmEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._bgmEditorTab.html();
    this.bindPanel();
    this._bgmEditorTab.mount();
  }

  showLocationEditor() {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    this._locationEditorTab = new DevLocationEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._locationEditorTab.html();
    this.bindPanel();
    this._locationEditorTab.mount();
  }

  showDormComputerEditor() {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    this._dormComputerTab = new DevDormComputerTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._dormComputerTab.html();
    this.bindPanel();
    this._dormComputerTab.mount();
  }

  showStructuredEditor(key) {
    this._unmountEditorTabs();
    this._setPanelKind("data");
    const EditorClass = DEDICATED_EDITOR_CLASSES[key];
    if (!EditorClass) { this.setStatus(`未知专用编辑器：${key}`, true); return; }
    this._structuredEditorTab = new EditorClass(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._structuredEditorTab.html();
    this.bindPanel();
    this._structuredEditorTab.mount();
  }

  showState() {
    this._activeRuntimeMethod = "showState";
    const { total, hour, minute } = clockParts();
    const time = timeService.snapshot();
    const achievements = achievementManager.getAllAchievements().map(({ def, state }) => `<tr><td>${esc(def.name || def.title || def.id)}</td><td><code>${esc(def.id)}</code></td><td>${state?.unlocked ? "已解锁" : "未解锁"}</td><td>${state?.progress || 0}</td><td>${state?.seen ? "已查看" : "未查看"}</td><td>${state?.unlocked ? button("标记已查看", `mark-achievement-${def.id}`) : button("强制解锁", `unlock-achievement-${def.id}`)}</td></tr>`).join("");
    this.panel(`
      <section class="dev-section"><h3>快速读档</h3>
        <textarea data-save-input class="dev-textarea dev-save-input" placeholder="粘贴存档字符串（可带 ?）"></textarea>
        <div>${button("解析并载入（不修改 URL）", "load-save")} ${button("保存当前游戏", "save-game")}</div>
      </section>
      <section class="dev-section"><h3>时间</h3>
        <label>第 <input data-day type="number" min="1" value="${gameState.day}"> 日</label>
        <label>时 <input data-hour type="number" min="0" max="23" value="${hour}"></label>
        <label>分 <input data-minute type="number" min="0" max="59" value="${minute}"></label>
        <label>地点 <select data-location><option value="work" ${gameState.location === "work" ? "selected" : ""}>工作</option><option value="dorm" ${gameState.location === "dorm" ? "selected" : ""}>宿舍</option></select></label>
        <div>${button("应用时间", "apply-time")} ${button("强制下班（忽略阻塞）", "force-end-work")} <span>当前总分钟：${total}；阶段累计：${time.phaseMinutes} 分钟</span></div>
        <p>阶段：${esc(gameState.phase)}；值班：${esc(gameState.duty)}；位置：${esc(gameState.location)}；睡眠历史：${esc((time.sleepHistory || []).join(", ") || "无")}；连续睡眠不足：${time.insufficientSleepStreak || 0} 天</p>
      </section>
      <section class="dev-section"><h3>成就调试器</h3>
        <p>成就使用 AchievementManager 的跨周目 localStorage 状态，不属于单局 URL 存档。</p>
        <div>${button("重置全部成就", "reset-achievements")}</div>
        <table class="dev-table"><thead><tr><th>成就</th><th>ID</th><th>状态</th><th>进度</th><th>查看</th><th>操作</th></tr></thead><tbody>${achievements || "<tr><td colspan=6>成就数据尚未加载</td></tr>"}</tbody></table>
      </section>
    `);
  }

  showNpcState() {
    this._activeRuntimeMethod = "showNpcState";
    const actors = [{ id: "chatgtp", name: "ChatGTP", favorability: null }, ...npcStateManager.npcs.map((npc) => ({ id: npc.id, name: npc.name, favorability: favorabilityManager.get(npc.id) }))];
    const rows = actors.map((actor) => `<tr data-npc-state-row="${esc(actor.id)}"><td>${esc(actor.name)}<br><code>${esc(actor.id)}</code></td><td><input data-npc-san type="number" min="0" max="100" value="${npcStateManager.get(actor.id)}"></td><td>${actor.favorability == null ? "—" : `<input data-npc-favor type="number" min="0" max="100" value="${actor.favorability}">`}<br><small>曾增加：${actor.favorability == null ? "—" : favorabilityManager.snapshot().hadPositive?.includes(actor.id) ? "是" : "否"}</small></td><td>${npcStateManager.isOffline(actor.id) ? "离线" : npcStateManager.isDistressed(actor.id) ? "不稳定" : "在线"}${npcStateManager.snapshot().pendingOffline?.includes(actor.id) ? "（待离线）" : ""}</td></tr>`).join("");
    const hisProgress = dialogueProgress.get("his");
    const socialProgress = dialogueProgress.get("social");
    const chatgtpProgress = dialogueProgress.get("chatgtp");
    this.panel(`<section class="dev-section"><h3>NPC与对话</h3><p>通过 NPC 状态和好感度所有者 API 修改运行时值；对话进度单独保存并可恢复。</p><table class="dev-table"><thead><tr><th>角色</th><th>SAN</th><th>好感度</th><th>当前状态</th></tr></thead><tbody>${rows}</tbody></table><label><input data-force-offline type="checkbox"> 将 SAN 不高于离线阈值的角色强制设为离线</label><div>${button("应用 NPC 状态", "apply-npc-state")}</div></section><section class="dev-section"><h3>对话进度</h3><p>设置后，重新打开对应应用时会从指定角色和节点继续。</p><label>应用 <select data-dialogue-app><option value="his">HIS</option><option value="social">Social</option><option value="chatgtp">ChatGTP</option></select></label><label>角色 ID <input data-dialogue-actor value="${esc(hisProgress.actorId || "")}" placeholder="例如 ajie"></label><label>节点 ID <input data-dialogue-node value="${esc(hisProgress.nodeId || "")}" placeholder="例如 start"></label><div>${button("应用对话状态", "apply-dialogue-state")} ${button("清除对话状态", "clear-dialogue-state")}</div><p class="dev-current-file">当前 HIS：${esc(hisProgress.actorId || "无")} / ${esc(hisProgress.nodeId || "无")}；Social：${esc(socialProgress.actorId || "无")} / ${esc(socialProgress.nodeId || "无")}；ChatGTP：${esc(chatgtpProgress.nodeId || "无")}</p></section>`);
    const appSelect = this.root.querySelector("[data-dialogue-app]");
    appSelect.addEventListener("change", () => {
      const progress = dialogueProgress.get(appSelect.value);
      this.root.querySelector("[data-dialogue-actor]").value = progress.actorId || (appSelect.value === "chatgtp" ? "chatgtp" : "");
      this.root.querySelector("[data-dialogue-node]").value = progress.nodeId || "";
    });
  }

  showInventory() {
    this._activeRuntimeMethod = "showInventory";
    const defs = itemManager.allDefIds().map((id) => {
      const def = itemManager.getDef(id);
      return `<option value="${id}">${def.name || id} (${id})</option>`;
    }).join("");
    const stats = ["energy", "mental", "physical", "satiety"].map((id) => `<label>${id} <input data-player-stat="${id}" type="number" min="0" max="255" value="${gameState[id]}"></label>`).join("");
    const recoverable = `<label>recoverableMentalLoss <input data-player-stat="recoverableMentalLoss" type="number" min="0" value="${gameState.recoverableMentalLoss}"></label>`;
    const learned = spellManager.all().map((spell) => `<li>${esc(spell.name || spell.id)} <code>${esc(spell.id)}</code></li>`).join("") || "<li>尚未学习法术</li>";
    const keywords = keywordManager.all().filter((keyword) => keyword.collectedDay != null).map((keyword) => `<li>${esc(keyword.content || keyword.id)} <code>${esc(keyword.id)}</code>（第 ${keyword.collectedDay} 日）</li>`).join("") || "<li>尚未收集关键词</li>";
    this.panel(`<section class="dev-section"><h3>玩家与资源</h3><p>玩家属性通过 GameState 修改；库存、法术和关键词使用各自的运行时管理器。</p><div>${stats} ${recoverable} ${button("应用玩家属性", "apply-player-stats")}</div></section><section class="dev-section"><h3>物品背包</h3>
      <div class="dev-inventory-add"><select data-item-id>${defs}</select><input data-item-count type="number" min="1" value="1">${button("增加", "add-item")}</div>
      <table class="dev-table"><thead><tr><th>物品</th><th>ID</th><th>数量</th><th>操作</th></tr></thead><tbody>
      ${itemManager.all().map(({ id, count, def }) => `<tr><td>${def.name}</td><td>${id}</td><td>${count}</td><td>${button("−1", `remove-item-${id}`)} ${button("清空", `clear-item-${id}`)}</td></tr>`).join("") || "<tr><td colspan=4>背包为空</td></tr>"}
      </tbody></table></section><section class="dev-section"><h3>已学习法术</h3><ul>${learned}</ul><h3>已收集关键词</h3><ul>${keywords}</ul></section>`);
  }

  async showSchedules() {
    this._activeRuntimeMethod = "showSchedules";
    await scheduleData.init();
    const category = this._scheduleCatalogCategory || "calendar";
    const catalog = scheduleData.catalog(category);
    const categoryOptions = Object.entries(SCHEDULE_CATEGORIES).map(([id, label]) => `<option value="${id}" ${id === category ? "selected" : ""}>${label}</option>`).join("");
    const scheduleOptions = catalog.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.id)}（${esc(entry.queueId)}）</option>`).join("");
    const queues = [["work", workQueue], ["social", socialQueue], ["chatgtp", chatgtpQueue], ["realtime", realtimeQueue]];
    const sections = queues.map(([id, queue]) => `<section class="dev-section"><h3>${id} 队列（${queue.getAll().length}）</h3><table class="dev-table"><thead><tr><th>实例</th><th>日程</th><th>状态</th><th>当前流程节点</th><th>接收时间</th><th>操作</th></tr></thead><tbody>${queue.getAll().map((entry) => { const blueprint = normalizeBlueprint(entry.payload?.blueprint || entry.payload || entry); const currentNodeId = entry.currentNodeId || blueprint.startNodeId || "未开始"; const currentNode = blueprint.nodes?.[currentNodeId]; const jump = entry.status === "resolved" ? "" : `<select data-schedule-jump="${esc(entry.instanceId)}">${scheduleNodeOptions(entry)}</select> ${button("强制跳转", `jump-queue-${id}-${entry.instanceId}`)}`; return `<tr><td><code>${esc(entry.instanceId)}</code></td><td>${esc(entry.scheduleId)}</td><td>${esc(entry.status)}</td><td><code>${esc(currentNodeId)}</code><br><span>${esc(scheduleNodeContent(currentNode) || "—")}</span></td><td>${entry.receivedDay || "—"} / ${entry.receivedTime ?? "—"}</td><td>${entry.status === "resolved" ? button("标记未解决", `reopen-queue-${id}-${entry.instanceId}`) : `${button("标记已解决", `resolve-queue-${id}-${entry.instanceId}`)} ${jump}`}</td></tr>`; }).join("") || "<tr><td colspan=6>空</td></tr>"}</tbody></table></section>`).join("");
    const scheduled = scheduleData.snapshotScheduled();
    this.panel(`<section class="dev-section"><h3>日程与队列</h3><p>显示四个独立队列及日程实例。未完成实例会记录当前流程节点，可标记已解决、标记未解决，或选择节点 ID（同时显示节点内容）后强制跳转。</p><div class="dev-schedule-create"><strong>插入新建日程实例</strong><label>日程表 <select data-schedule-category>${categoryOptions}</select></label><label>日程 <select data-schedule-definition>${scheduleOptions || "<option value=\"\">（该类别暂无日程）</option>"}</select></label><span>将自动进入该日程所属队列</span>${button("新建", "create-schedule-instance")} ${button("插入临时日程", "insert-temporary-schedule")}</div><p>ScheduleData：已触发时段 ${scheduleData.fired?.size || 0}；待追加日程 ${scheduled.length}；最近绝对分钟 ${scheduleData.lastAbsoluteMinute ?? "无"}</p><ul>${scheduled.map((entry) => `<li><code>${esc(entry.scheduleId)}</code> → ${entry.addTime}（${esc(entry.queueId || "默认队列")}）</li>`).join("") || "<li>暂无动态追加日程</li>"}</ul></section>${sections}`);
    this.root.querySelector("[data-schedule-category]")?.addEventListener("change", (event) => { this._scheduleCatalogCategory = event.target.value; this.showSchedules(); });
  }

  showWorld() {
    this._activeRuntimeMethod = "showWorld";
    const placements = itemPlacementManager.all().map((placement) => `<tr><td>${esc(placement.id)}</td><td>${esc(placement.itemId)}</td><td>${itemPlacementManager.isPlaced(placement.id) ? "已放置" : "已取走"}</td><td>${itemPlacementManager.isVisible(placement.id) ? "可见" : "不可见"}</td><td>${button(itemPlacementManager.isPlaced(placement.id) ? "取走" : "放回", `toggle-placement-${placement.id}`)}</td></tr>`).join("");
    const variables = globalVariableManager.all().map((variable) => `<tr><td>${variable.id}</td><td>${esc(variable.name)}</td><td><input data-runtime-gv="${variable.id}" data-runtime-gv-type="${variable.type}" value="${esc(String(variable.value))}"></td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>世界与场景</h3><p>场景物品和全局变量均通过各自状态所有者 API 修改。</p><table class="dev-table"><thead><tr><th>摆放 ID</th><th>物品</th><th>位置状态</th><th>当前可见</th><th>操作</th></tr></thead><tbody>${placements || "<tr><td colspan=5>暂无摆放</td></tr>"}</tbody></table></section><section class="dev-section"><h3>全局变量当前值</h3><table class="dev-table"><thead><tr><th>ID</th><th>名称</th><th>值</th></tr></thead><tbody>${variables || "<tr><td colspan=3>暂无变量</td></tr>"}</tbody></table><div>${button("应用全局变量", "apply-runtime-variables")}</div></section>`);
  }

  showMedicalEnding() {
    this._activeRuntimeMethod = "showMedicalEnding";
    const medical = medicalCaseManager.snapshot();
    const submissions = (medical.submissions || []).map((submission) => `<tr><td>${esc(submission.patientId)}</td><td>${submission.day}</td><td>${submission.dueDay}</td><td>${esc(submission.diagnosisId)}</td><td>${submission.processed ? "已处理" : "待处理"}</td></tr>`).join("");
    const endings = [...endingManager.defs.keys()].map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join("");
    this.panel(`<section class="dev-section"><h3>医疗与结局</h3><p>医疗提交、待结算金额和延迟事件均来自 MedicalCaseManager；结局遵循 EndingManager 的首个结局规则。</p><p>当前收入：${medical.income}；待收入：${medical.pendingIncome}；待支出：${medical.pendingExpenses}；待处理事件：${(medical.pendingIncidents || []).length}；已结束：${endingManager.isEnded ? "是" : "否"}</p><table class="dev-table"><thead><tr><th>患者</th><th>提交日</th><th>到期日</th><th>诊断</th><th>状态</th></tr></thead><tbody>${submissions || "<tr><td colspan=5>暂无提交</td></tr>"}</tbody></table><div>${button("结算上一日医疗账目", "settle-medical-day")} ${button("重置结局锁定", "reset-ending")}</div><label>触发结局 <select data-ending-id>${endings}</select> ${button("触发", "trigger-ending")}</label></section>`);
  }

  async loadDoc(fileName) {
    if (!this.docs.has(fileName)) this.docs.set(fileName, clone(await dataLoader.loadJSON(fileName)));
    return this.docs.get(fileName);
  }


  async showKeywords() {
    const doc = await this.loadDoc("keywords.json");
    const rows = (doc.keywords || []).map((k, i) => `<tr data-keyword-row="${i}"><td><input data-k-id value="${esc(k.id)}"></td><td><input data-k-content value="${esc(k.content || k.label || "")}"></td><td>${button("删除", `remove-keyword-${i}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>关键词编辑器</h3><p>关键词只保存稳定 ID 和显示内容。疾病关键词的介绍、药物和秘药资料请在 ChatGTP 编辑器中修改。</p><table class="dev-table dev-keyword-table"><thead><tr><th>ID</th><th>内容</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增关键词", "add-keyword")} ${button("保存关键词到内存", "save-keywords")} ${button("下载 keywords.json", "download-keywords")} ${button("写入磁盘", "write-keywords")}</div></section>`, "data");
  }

  _syncQaPage() {
    if (!this.qaDraft) return;
    this.root.querySelectorAll("[data-qa-entry]").forEach((row) => {
      const index = Number(row.dataset.qaEntry);
      const selected = Array.from(row.querySelectorAll("[data-qa-keyword]"), (select) => select.value).filter(Boolean);
      const entry = this.qaDraft[index];
      if (!entry) return;
      entry.keywords = [...new Set(selected)];
      entry.answer = row.querySelector("[data-qa-answer]")?.value || "";
      entry.corruptedSameAsNormal = row.querySelector("[data-qa-same]")?.checked || false;
      if (entry.corruptedSameAsNormal) delete entry.corruptedAnswer;
      else entry.corruptedAnswer = row.querySelector("[data-qa-corrupted]")?.value || "";
    });
  }

  async showChatgtp() {
    const qa = await this.loadDoc("chatgtp_qa.json");
    const keywordDoc = await this.loadDoc("keywords.json");
    if (!this.qaDraft) this.qaDraft = qa.entries || [];
    const keywords = keywordDoc.keywords || [];
    const byId = new Map(keywords.map((keyword) => [keyword.id, keyword]));
    const categories = [...new Set(keywords.map(keywordCategory))];
    const filtered = this.qaDraft.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
      if (!this.qaCategory) return true;
      return (entry.keywords || []).some((id) => keywordCategory(byId.get(id)) === this.qaCategory);
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / QA_PAGE_SIZE));
    this.qaPage = Math.min(Math.max(1, this.qaPage), totalPages);
    const page = filtered.slice((this.qaPage - 1) * QA_PAGE_SIZE, this.qaPage * QA_PAGE_SIZE);
    const categoryOptions = [`<option value="">全部关键词类别</option>`, ...categories.map((category) => `<option value="${category}" ${category === this.qaCategory ? "selected" : ""}>${KEYWORD_CATEGORY_LABELS[category] || category}</option>`)].join("");
    const rows = page.map(({ entry, index }) => {
      const selected = (entry.keywords || []).map((value) => byId.has(value) ? value : value);
      const option = (slot) => {
        const visibleKeywords = keywords.filter((keyword) => keywordCategory(keyword) === this.qaCategory || selected.includes(keyword.id));
        return `<select data-qa-keyword data-qa-slot="${slot}"><option value="">（不选择）</option>${visibleKeywords.map((keyword) => `<option value="${esc(keyword.id)}" ${selected[slot] === keyword.id ? "selected" : ""}>${esc(keyword.content || keyword.label || keyword.id)} (${esc(keyword.id)})</option>`).join("")}</select>`;
      };
      const same = Boolean(entry.corruptedSameAsNormal);
      return `<article class="dev-qa-entry" data-qa-entry="${index}"><header><strong>${index + 1}. 关键词组合</strong>${option(0)} + ${option(1)}${button("删除", `remove-qa-entry-${index}`)}</header><label>正常回答<textarea data-qa-answer rows="3">${esc(entry.answer)}</textarea></label><label class="dev-checkbox-label"><input type="checkbox" data-qa-same ${same ? "checked" : ""}> SAN 较低时使用正常回答</label><label>损坏时回答<textarea data-qa-corrupted rows="3" ${same ? "disabled" : ""}>${esc(entry.corruptedAnswer || "")}</textarea></label></article>`;
    }).join("");
    this.panel(`<section class="dev-section"><h3>ChatGTP 问答编辑器</h3><p>先按关键词类别筛选，再为每条问答选择两个关键词。列表每页最多显示 ${QA_PAGE_SIZE} 条，避免一次创建数万条编辑 DOM。</p><label>关键词类别 <select data-qa-category>${categoryOptions}</select></label><span>当前显示 ${page.length} / ${filtered.length} 条（总计 ${this.qaDraft.length} 条）</span><div class="dev-qa-list">${rows || "暂无符合条件的问答条目"}</div><div>${button("上一页", "qa-page-prev")} <span>第 ${this.qaPage} / ${totalPages} 页</span> ${button("下一页", "qa-page-next")} ${button("新增问答", "add-qa-entry")} ${button("保存问答到内存", "save-qa")} ${button("下载 chatgtp_qa.json", "download-qa")} ${button("写入磁盘", "write-qa")}</div></section>`, "data");
    this.root.querySelector("[data-qa-category]")?.addEventListener("change", (event) => { this._syncQaPage(); this.qaCategory = event.target.value; this.qaPage = 1; this.showChatgtp(); });
    this.root.querySelectorAll("[data-qa-same]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      checkbox.closest("[data-qa-entry]").querySelector("[data-qa-corrupted]").disabled = checkbox.checked;
    }));
  }


  async showNpcs() {
    const doc = await this.loadDoc("npcs.json");
    const rows = (doc.npcs || []).map((npc, index) => `<tr data-npc-row="${index}"><td><input data-npc-id value="${esc(npc.id)}"></td><td><input data-npc-name value="${esc(npc.name)}"></td><td><input data-npc-avatar value="${esc(npc.avatar || "🙂")}"></td><td><input data-npc-favor type="number" min="0" max="100" value="${Number(npc.initialFavorability) || 0}"></td><td><input data-npc-san type="number" min="0" max="100" value="${Number(npc.initialSan) || 0}"></td><td>${button("删除", `remove-npc-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>NPC 列表</h3><p>维护特殊事件使用的稳定 NPC ID、名字、头像、初始好感度和初始 SAN。主角对话节点可通过 <code>onShow.favorabilityChange</code> 改变好感度。</p><table class="dev-table"><thead><tr><th>ID</th><th>名字</th><th>头像</th><th>初始好感度</th><th>初始 SAN</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增 NPC", "add-npc")} ${button("保存 NPC 到内存", "save-npcs")} ${button("下载 npcs.json", "download-npcs")} ${button("写入磁盘", "write-npcs")}</div></section>`, "data");
  }

  showGlobalVariables() {
    const valueText = (variable, value) => variable.type === "string" ? value : String(value);
    const rows = globalVariableManager.all().map((variable, index) => `<tr data-global-variable-row="${index}"><td><input data-gv-id type="number" min="0" step="1" value="${variable.id}"></td><td><input data-gv-name value="${esc(variable.name)}"></td><td><select data-gv-type><option value="bool" ${variable.type === "bool" ? "selected" : ""}>bool</option><option value="number" ${variable.type === "number" ? "selected" : ""}>0-256 数字</option><option value="string" ${variable.type === "string" ? "selected" : ""}>字符串</option></select></td><td><input data-gv-default value="${esc(valueText(variable, variable.default))}"></td><td><input data-gv-value value="${esc(valueText(variable, variable.value))}"></td><td>${button("删除", `remove-global-variable-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>全局变量编辑器</h3><p>全局变量由 ID、名称和类型定义。对话节点/选项可使用 <code>condition: { id, op, value }</code>，节点副作用可使用 <code>onShow.globalVariables: [{ id, value }]。</code> 修改只存在于当前页面；请下载 JSON 保存到项目。</p><table class="dev-table dev-global-variable-table"><thead><tr><th>ID</th><th>名称</th><th>类型</th><th>默认值</th><th>当前值</th><th>操作</th></tr></thead><tbody>${rows || "<tr><td colspan=6>暂无全局变量</td></tr>"}</tbody></table><div>${button("新增变量", "add-global-variable")} ${button("保存到内存", "save-global-variables")} ${button("下载 global_variables.json", "download-global-variables")} ${button("写入磁盘", "write-global-variables")}</div></section>`, "data");
  }

  _readGlobalVariableRows() {
    const parse = (raw, type, id, field) => {
      if (type === "bool") {
        if (raw !== "true" && raw !== "false") throw new Error(`变量 ${id} 的${field}必须是 true 或 false`);
        return raw === "true";
      }
      if (type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > 256) throw new Error(`变量 ${id} 的${field}必须是 0-256 的数字`);
        return value;
      }
      return raw;
    };
    return Array.from(this.root.querySelectorAll("[data-global-variable-row]"), (row) => {
      const id = Number(row.querySelector("[data-gv-id]").value);
      const type = row.querySelector("[data-gv-type]").value;
      return {
        id,
        name: row.querySelector("[data-gv-name]").value.trim(),
        type,
        default: parse(row.querySelector("[data-gv-default]").value, type, id, "默认值"),
        value: parse(row.querySelector("[data-gv-value]").value, type, id, "当前值"),
      };
    });
  }


  async handle(action, source = null) {
    if (action === "open-editor") return this.openEditorWindow(source?.dataset.editorAction, source?.dataset.editorTitle, source?.dataset.editorKind);
    if (action === "tab-item-editor") return this.showItemEditor();
    if (action === "tab-dialogue-editor") return this.showDialogueEditor();
    if (action === "tab-bgm-editor") return this.showBgmEditor();
    if (action === "tab-location-editor") return this.showLocationEditor();
    if (action === "tab-dorm-computer") return this.showDormComputerEditor();
    if (action === "tab-state") { this._unmountEditorTabs(); return this.showState(); }
    if (action === "tab-inventory") { this._unmountEditorTabs(); return this.showInventory(); }
    if (action === "tab-npc-state") { this._unmountEditorTabs(); return this.showNpcState(); }

    if (action === "tab-keywords") { this._unmountEditorTabs(); return this.showKeywords(); }
    if (action === "tab-chatgtp") { this._unmountEditorTabs(); return this.showChatgtp(); }
    if (action === "tab-npcs") { this._unmountEditorTabs(); return this.showNpcs(); }
    if (action === "tab-global-variables") { this._unmountEditorTabs(); return this.showGlobalVariables(); }

    const structuredTab = action.match(/^tab-structured-(.+)$/);
    if (structuredTab) return this.showStructuredEditor(structuredTab[1]);
    const dedicatedAction = {
      "add-node": "addNode", "remove-node": "removeNode", "add-option": "addOption", "remove-option": "removeOption",
      "add-placement": "addPlacement", "remove-placement": "removePlacement", "add-category": "addCategory", "remove-category": "removeCategory",
      "add-diagnosis": "addDiagnosis", "remove-diagnosis": "removeDiagnosis", "add-tag": "addTag", "remove-tag": "removeTag",
      "add-medicine": "addMedicine", "remove-medicine": "removeMedicine", "add-dialogue": "addDialogue", "remove-dialogue": "removeDialogue",
      "add-day": "addDay", "remove-day": "removeDay", "add-achievement": "addAchievement", "remove-achievement": "removeAchievement",
      "add-skill": "addSkill", "remove-skill": "removeSkill", "add-scene": "addScene", "remove-scene": "removeScene",
    }[action];
    if (dedicatedAction && this._structuredEditorTab?.[dedicatedAction]) {
      const value = source?.dataset.ddValue || "";
      return this._structuredEditorTab[dedicatedAction](value);
    }
    if (action === "structured-reload") return this._structuredEditorTab?.reload();
    if (action === "structured-save") {
      try { return this._structuredEditorTab?.save(); }
      catch (error) { this.setStatus(`保存失败：${error.message}`, true); return; }
    }
    if (action === "structured-download") {
      try { return this._structuredEditorTab?.download(); }
      catch (error) { this.setStatus(`下载失败：${error.message}`, true); return; }
    }
    if (action === "structured-write") {
      try { return await this._structuredEditorTab?.write(); }
      catch (error) { this.setStatus(`写入失败：${error.message}`, true); return; }
    }
    if (action === "qa-page-prev" || action === "qa-page-next") {
      this._syncQaPage();
      this.qaPage += action === "qa-page-prev" ? -1 : 1;
      return this.showChatgtp();
    }
    if (action === "add-global-variable") {
      const nextId = globalVariableManager.all().reduce((max, variable) => Math.max(max, variable.id), -1) + 1;
      const doc = await this.loadDoc("global_variables.json");
      const variables = Array.isArray(doc) ? doc : Array.isArray(doc.variables) ? doc.variables : [];
      variables.push({ id: nextId, name: `变量${nextId}`, type: "bool", default: false });
      this.docs.set("global_variables.json", variables);
      globalVariableManager.replaceDefinitions(variables);
      return this.showGlobalVariables();
    }
    const removeGlobalVariable = action.match(/^remove-global-variable-(\d+)$/);
    if (removeGlobalVariable) {
      const doc = await this.loadDoc("global_variables.json");
      const variables = Array.isArray(doc) ? doc : Array.isArray(doc.variables) ? doc.variables : [];
      variables.splice(Number(removeGlobalVariable[1]), 1);
      this.docs.set("global_variables.json", variables);
      globalVariableManager.replaceDefinitions(variables);
      return this.showGlobalVariables();
    }
    if (action === "save-global-variables" || action === "download-global-variables" || action === "write-global-variables") {
      try {
        const variables = this._readGlobalVariableRows();
        globalVariableManager.replaceDefinitions(variables);
        variables.forEach((variable) => globalVariableManager.set(variable.id, variable.value));
        const doc = variables.map(({ id, name, type, default: defaultValue }) => ({ id, name, type, default: defaultValue }));
        this.docs.set("global_variables.json", doc);
        if (action === "download-global-variables") { downloadJson("global_variables.json", doc); this.setStatus("global_variables.json 已下载。"); return this.showGlobalVariables(); }
        if (action === "write-global-variables") { await this.writeToDisk("global_variables.json", doc); return this.showGlobalVariables(); }
        this.setStatus("global_variables.json 已保存到内存。");
        return this.showGlobalVariables();
      } catch (err) {
        this.setStatus(`全局变量保存失败：${err.message}`, true);
        return;
      }
    }
    if (action === "load-save") {
      const raw = this.root.querySelector("[data-save-input]").value.trim().replace(/^\?/, "");
      const ok = raw && saveManager.loadFromString(raw, { updateLocation: false });
      this.setStatus(ok ? "存档已载入，地址栏未改变。" : "存档字符串无效。", !ok);
      if (ok) this.showState();
      return;
    }
    if (action === "save-game") {
      const url = saveManager.save();
      const encoded = url.split("?")[1] || "";
      const input = this.root.querySelector("[data-save-input]");
      if (input) input.value = encoded;
      this.setStatus(`当前游戏已保存（${encoded.length} 字符，地址栏已更新）。`);
      return;
    }
    const achievementAction = action.match(/^(unlock|mark)-achievement-(.+)$/);
    if (achievementAction) {
      const id = achievementAction[2];
      if (achievementAction[1] === "unlock") achievementManager.unlock(id);
      else achievementManager.markSeen(id);
      this.setStatus(achievementAction[1] === "unlock" ? `成就 ${id} 已强制解锁。` : `成就 ${id} 已标记为已查看。`);
      return this.showState();
    }
    if (action === "reset-achievements") {
      achievementManager.reset();
      this.setStatus("全部成就已重置。");
      return this.showState();
    }
    if (action === "apply-time") {
      const day = Math.max(1, Number(this.root.querySelector("[data-day]").value) || 1);
      const hour = Math.min(23, Math.max(0, Number(this.root.querySelector("[data-hour]").value) || 0));
      const minute = Math.min(59, Math.max(0, Number(this.root.querySelector("[data-minute]").value) || 0));
      const clock = hour * 60 + minute;
      const adjusted = timeService.debugSetTime(day, clock, this.root.querySelector("[data-location]").value);
      this.setStatus(`时间已调整为第 ${day} 日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}。`);
      return this.showState();
    }
    if (action === "force-end-work") {
      const result = dayNightSystem.forceEndWork();
      this.setStatus(result.ok
        ? "已强制下班，忽略未完成工作阻塞。"
        : "强制下班失败：当前不在工作值班状态。", !result.ok);
      return this.showState();
    }

    if (action === "apply-player-stats") {
      const changes = {};
      ["energy", "mental", "physical", "satiety"].forEach((id) => {
        const input = this.root.querySelector(`[data-player-stat="${id}"]`);
        if (!input) return;
        const max = id === "satiety" ? 255 : 100;
        const value = Math.max(0, Math.min(max, Number(input.value) || 0));
        changes[id] = value - gameState[id];
      });
      gameState.modify(changes);
      const recoveryInput = this.root.querySelector('[data-player-stat="recoverableMentalLoss"]');
      if (recoveryInput) gameState.restore({ ...gameState.snapshot(), recoverableMentalLoss: Math.max(0, Number(recoveryInput.value) || 0) });
      this.setStatus("玩家属性已应用。");
      return this.showInventory();
    }
    if (action === "create-schedule-instance") {
      const scheduleId = this.root.querySelector("[data-schedule-definition]")?.value;
      const result = await scheduleData.createInstance(scheduleId);
      this.setStatus(result.ok ? `日程实例 ${result.instance.instanceId} 已插入 ${result.queueId} 队列。` : `新建日程失败：${result.reason}`, !result.ok);
      return this.showSchedules();
    }
    if (action === "insert-temporary-schedule") return this.openTemporaryScheduleEditor();
    const queueAction = action.match(/^(resolve|reopen)-queue-(work|social|chatgtp|realtime)-(.+)$/);
    if (queueAction) {
      const queues = { work: workQueue, social: socialQueue, chatgtp: chatgtpQueue, realtime: realtimeQueue };
      const queue = queues[queueAction[2]];
      const ok = queue.updateInstance(queueAction[3], { status: queueAction[1] === "resolve" ? "resolved" : "unresolved" });
      this.setStatus(ok ? "日程实例状态已更新。" : "未找到日程实例。", !ok);
      return this.showSchedules();
    }
    const jumpAction = action.match(/^jump-queue-(work|social|chatgtp|realtime)-(.+)$/);
    if (jumpAction) {
      const queueId = jumpAction[1];
      const instanceId = jumpAction[2];
      const queue = { work: workQueue, social: socialQueue, chatgtp: chatgtpQueue, realtime: realtimeQueue }[queueId];
      const select = Array.from(this.root.querySelectorAll("[data-schedule-jump]"))
        .find((element) => element.dataset.scheduleJump === instanceId);
      const entry = queue.getInstance(instanceId);
      const nodeId = select?.value;
      const blueprint = entry ? normalizeBlueprint(entry.payload?.blueprint || entry.payload || entry) : null;
      const ok = Boolean(entry && entry.status === "unresolved" && nodeId && blueprint?.nodes?.[nodeId]
        && queue.updateInstance(instanceId, {
          currentNodeId: nodeId,
          executedNodeIds: (entry.executedNodeIds || []).filter((id) => id !== nodeId),
        }));
      this.setStatus(ok ? `日程实例已强制跳转到节点 ${nodeId}。` : "强制跳转失败：实例或流程节点无效。", !ok);
      return this.showSchedules();
    }
    const placementAction = action.match(/^toggle-placement-(.+)$/);
    if (placementAction) {
      const id = placementAction[1];
      const ok = itemPlacementManager.setPlaced(id, !itemPlacementManager.isPlaced(id));
      this.setStatus(ok ? "场景物品位置已更新。" : "未找到场景物品。", !ok);
      return this.showWorld();
    }
    if (action === "settle-medical-day") {
      const result = medicalCaseManager.settleDay(Math.max(1, gameState.day - 1));
      this.setStatus(`医疗账目已结算：收入 ${result.income}，支出 ${result.expenses}。`);
      return this.showMedicalEnding();
    }
    if (action === "reset-ending") {
      endingManager.reset();
      this.setStatus("结局锁定已重置。");
      return this.showMedicalEnding();
    }
    if (action === "trigger-ending") {
      const id = this.root.querySelector("[data-ending-id]")?.value;
      endingManager.trigger(id);
      this.setStatus(endingManager.isEnded ? `已触发结局：${id}。` : "结局未触发（可能已有结局或 ID 无效）。");
      return this.showMedicalEnding();
    }
    if (action === "apply-runtime-variables") {
      try {
        this.root.querySelectorAll("[data-runtime-gv]").forEach((input) => {
          const type = input.dataset.runtimeGvType;
          const value = type === "bool" ? input.value === "true" : type === "number" ? Number(input.value) : input.value;
          globalVariableManager.set(Number(input.dataset.runtimeGv), value);
        });
        this.setStatus("全局变量运行时值已应用。");
      } catch (error) {
        this.setStatus(`全局变量应用失败：${error.message}`, true);
      }
      return this.showWorld();
    }

    const itemMatch = action.match(/^(remove|clear)-item-(.+)$/);
    if (itemMatch) { itemManager.remove(itemMatch[2], itemMatch[1] === "clear" ? itemManager.count(itemMatch[2]) : 1); return this.showInventory(); }
    if (action === "add-item") { itemManager.add(this.root.querySelector("[data-item-id]").value, Math.max(1, Number(this.root.querySelector("[data-item-count]").value) || 1)); return this.showInventory(); }
    if (action === "apply-npc-state") {
      const forceOffline = this.root.querySelector("[data-force-offline]")?.checked;
      const offlineThreshold = Number(npcStateManager.config?.offlineThreshold) || 20;
      this.root.querySelectorAll("[data-npc-state-row]").forEach((row) => {
        const actorId = row.dataset.npcStateRow;
        const san = Math.max(0, Math.min(100, Number(row.querySelector("[data-npc-san]")?.value) || 0));
        npcStateManager.setSan(actorId, san, { offline: forceOffline && san <= offlineThreshold });
        const favorInput = row.querySelector("[data-npc-favor]");
        if (favorInput) favorabilityManager.modify(actorId, Math.max(0, Math.min(100, Number(favorInput.value) || 0)) - favorabilityManager.get(actorId));
      });
      this.setStatus("NPC与对话状态已应用。");
      return this.showNpcState();
    }
    if (action === "apply-dialogue-state" || action === "clear-dialogue-state") {
      const app = this.root.querySelector("[data-dialogue-app]")?.value;
      const actorId = action === "clear-dialogue-state" ? null : this.root.querySelector("[data-dialogue-actor]")?.value.trim() || null;
      const nodeId = action === "clear-dialogue-state" ? null : this.root.querySelector("[data-dialogue-node]")?.value.trim() || null;
      dialogueProgress.set(app, app === "chatgtp" ? "chatgtp" : actorId, nodeId);
      this.setStatus(action === "clear-dialogue-state" ? "对话状态已清除。" : `${app} 对话状态已设置为 ${actorId || "无"} / ${nodeId || "无"}。`);
      return this.showNpcState();
    }

    const removeQa = action.match(/^remove-qa-entry-(\d+)$/);
    if (removeQa) { this._syncQaPage(); this.qaDraft.splice(Number(removeQa[1]), 1); this.qaPage = Math.min(this.qaPage, Math.max(1, Math.ceil(this.qaDraft.length / QA_PAGE_SIZE))); return this.showChatgtp(); }
    const removeNpc = action.match(/^remove-npc-(\d+)$/);
    if (removeNpc) { const doc = await this.loadDoc("npcs.json"); doc.npcs.splice(Number(removeNpc[1]), 1); this.docs.set("npcs.json", doc); return this.showNpcs(); }
    if (action === "add-npc") { const doc = await this.loadDoc("npcs.json"); doc.npcs = doc.npcs || []; doc.npcs.push({ id: `new_npc_${doc.npcs.length + 1}`, name: "新 NPC", avatar: "🙂", initialFavorability: 50, initialSan: 80 }); this.docs.set("npcs.json", doc); return this.showNpcs(); }
    if (action === "save-npcs" || action === "download-npcs" || action === "write-npcs") {
      const doc = await this.loadDoc("npcs.json"); const rows = Array.from(this.root.querySelectorAll("[data-npc-row]")); const ids = rows.map((row) => row.querySelector("[data-npc-id]").value.trim());
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) { this.setStatus("NPC 保存失败：ID 不能为空且不能重复。", true); return; }
      doc.npcs = rows.map((row) => ({ id: row.querySelector("[data-npc-id]").value.trim(), name: row.querySelector("[data-npc-name]").value, avatar: row.querySelector("[data-npc-avatar]").value || "🙂", initialFavorability: Math.max(0, Math.min(100, Number(row.querySelector("[data-npc-favor]").value) || 0)), initialSan: Math.max(0, Math.min(100, Number(row.querySelector("[data-npc-san]").value) || 0)) }));
      this.docs.set("npcs.json", doc);
      if (action === "download-npcs") { downloadJson("npcs.json", doc); this.setStatus("npcs.json 已下载。"); return; }
      if (action === "write-npcs") { await this.writeToDisk("npcs.json", doc); return; }
      this.setStatus("npcs.json 已保存到内存。"); return;
    }
    if (action === "add-qa-entry") { this._syncQaPage(); if (!this.qaDraft) this.qaDraft = []; this.qaDraft.push({ keywords: [], answer: "", corruptedAnswer: "", corruptedSameAsNormal: true }); this.qaPage = Math.ceil(this.qaDraft.length / QA_PAGE_SIZE); return this.showChatgtp(); }
    if (action === "save-qa" || action === "download-qa" || action === "write-qa") {
      const qa = await this.loadDoc("chatgtp_qa.json");
      this._syncQaPage();
      const entries = this.qaDraft || [];
      const keys = entries.map((entry) => [...entry.keywords].sort().join("+"));
      if (entries.some((entry) => entry.keywords.length === 0 || entry.keywords.length > 2 || !entry.answer.trim()) || new Set(keys).size !== keys.length) { this.setStatus("ChatGTP 保存失败：每条问答需要 1～2 个关键词、正常回答，且关键词组合不能重复。", true); return; }
      qa.entries = entries; this.docs.set("chatgtp_qa.json", qa);
      if (action === "download-qa") { downloadJson("chatgtp_qa.json", qa); this.setStatus("chatgtp_qa.json 已下载。"); return; }
      if (action === "write-qa") { await this.writeToDisk("chatgtp_qa.json", qa); return; }
      this.setStatus("chatgtp_qa.json 已保存到内存。"); return;
    }


    if (action === "add-keyword") { const doc = await this.loadDoc("keywords.json"); doc.keywords.push({ id: `new_keyword_${doc.keywords.length + 1}`, content: "新关键词" }); this.docs.set("keywords.json", doc); return this.showKeywords(); }
    if (action === "remove-keyword" || action.startsWith("remove-keyword-")) { const index = Number(action.split("-").pop()); const doc = await this.loadDoc("keywords.json"); doc.keywords.splice(index, 1); this.docs.set("keywords.json", doc); return this.showKeywords(); }

    if (action === "save-keywords" || action === "download-keywords" || action === "write-keywords") {
      const doc = await this.loadDoc("keywords.json");
      const rows = Array.from(this.root.querySelectorAll("[data-keyword-row]"));
      const ids = rows.map((row) => row.querySelector("[data-k-id]").value.trim());
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) { this.setStatus("关键词保存失败：ID 不能为空且不能重复。", true); return; }
      doc.keywords = rows.map((row) => {
        return { id: row.querySelector("[data-k-id]").value.trim(), content: row.querySelector("[data-k-content]").value };
      });
      this.docs.set("keywords.json", doc);
      if (action === "download-keywords") { downloadJson("keywords.json", doc); this.setStatus("keywords.json 已下载。"); return; }
      if (action === "write-keywords") { await this.writeToDisk("keywords.json", doc); return; }
      this.setStatus("keywords.json 已保存到内存。"); return;
    }
  }

}
// DEV-TOOLS:END
