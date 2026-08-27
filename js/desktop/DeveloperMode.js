// DEV-TOOLS:START
import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { scheduleData } from "../core/ScheduleData.js";
import { saveManager } from "../core/SaveManager.js";
import { gameState } from "../core/GameState.js";
import { actionBudget } from "../core/ActionBudget.js";
import { itemManager } from "../core/ItemManager.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { eventBus } from "../core/EventBus.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const DAY_FILES = () => Array.from({ length: scheduleData.totalDays }, (_, i) => {
  const day = i + 1;
  return [`day${String(day).padStart(2, "0")}a.json`, `day${String(day).padStart(2, "0")}b.json`];
}).flat();
const JSON_FILES = () => [
  ...DAY_FILES(),
  "chatgtp_qa.json",
  "keywords.json",
  "items.json",
  "medical_records.json",
  "medicines.json",
  "endings.json",
  "npc_state.json",
];

function button(text, action, className = "") {
  return `<button type="button" class="win95-btn dev-btn ${className}" data-dev-action="${action}">${text}</button>`;
}

function downloadJson(fileName, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clockParts() {
  const total = dayNightSystem.currentClockMinutes();
  return { total, hour: Math.floor(total / 60), minute: total % 60 };
}

function phaseForClock(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  if (normalized >= 8 * 60 && normalized < 16 * 60) {
    return { phase: "day", phaseMinutes: normalized - 8 * 60 };
  }
  return { phase: "night", phaseMinutes: normalized >= 16 * 60 ? normalized - 16 * 60 : normalized + 1440 - 16 * 60 };
}

export function launchDeveloperMode() {
  if (windowManager.getByAppId("developer-mode")) {
    windowManager.focus(windowManager.getByAppId("developer-mode").id);
    return;
  }
  const root = document.createElement("div");
  root.className = "developer-mode-root";
  const win = windowManager.createWindow({
    appId: "developer-mode",
    title: "开发人员模式",
    icon: "🛠️",
    width: 900,
    height: 680,
    content: root,
  });
  new DeveloperMode(root, win);
}

class DeveloperMode {
  constructor(root, win) {
    this.root = root;
    this.win = win;
    this.docs = new Map();
    this.selectedFile = "chatgtp_qa.json";
    this.actorFile = DAY_FILES()[0] || "day01a.json";
    this.actorType = "contacts";
    this.actorId = "";
    this.render();
  }

  render() {
    const files = JSON_FILES();
    this.root.innerHTML = `
      <div class="dev-toolbar">
        ${button("状态调节", "tab-state")}
        ${button("背包", "tab-inventory")}
        ${button("对话编辑器", "tab-dialogue")}
        ${button("患者编辑器", "tab-patient")}
        ${button("ChatGTP 编辑器", "tab-chatgtp")}
        ${button("JSON 文件", "tab-json")}
      </div>
      <div class="dev-status" data-dev-status>开发工具就绪。修改仅存在于当前页面，使用下载按钮导出。</div>
      <div class="dev-panel" data-dev-panel></div>
    `;
    this.root.querySelectorAll("[data-dev-action]").forEach((el) => el.addEventListener("click", () => this.handle(el.dataset.devAction)));
    this.showState();
  }

  setStatus(message, error = false) {
    const el = this.root.querySelector("[data-dev-status]");
    el.textContent = message;
    el.classList.toggle("dev-error", error);
  }

  panel(html) {
    this.root.querySelector("[data-dev-panel]").innerHTML = html;
    this.root.querySelectorAll("[data-dev-action]").forEach((el) => el.addEventListener("click", () => this.handle(el.dataset.devAction)));
    const jsonFile = this.root.querySelector("[data-json-file]");
    if (jsonFile) jsonFile.addEventListener("change", () => this.showJson(jsonFile.value));
    const actorFile = this.root.querySelector("[data-actor-file]");
    if (actorFile) actorFile.addEventListener("change", () => { this.actorFile = actorFile.value; this.actorId = ""; this.showActorEditor(); });
    const actorId = this.root.querySelector("[data-actor-id]");
    if (actorId) actorId.addEventListener("change", () => { this.actorId = actorId.value; this.showActorEditor(); });
    this.root.querySelectorAll("[data-keyword-insert]").forEach((el) => el.addEventListener("click", () => {
      const editor = this.root.querySelector("[data-actor-editor]");
      if (!editor) return;
      const marker = `[[${el.dataset.keywordInsert}]]`;
      const start = editor.selectionStart;
      editor.value = `${editor.value.slice(0, start)}${marker}${editor.value.slice(editor.selectionEnd)}`;
      editor.selectionStart = editor.selectionEnd = start + marker.length;
      editor.focus();
    }));
  }

  showState() {
    const { total, hour, minute } = clockParts();
    const stats = ["energy", "mental", "physical", "satiety"];
    this.panel(`
      <section class="dev-section"><h3>快速读档</h3>
        <textarea data-save-input class="dev-textarea dev-save-input" placeholder="粘贴存档字符串（可带 ?）"></textarea>
        <div>${button("解析并载入（不修改 URL）", "load-save")}</div>
      </section>
      <section class="dev-section"><h3>时间</h3>
        <label>第 <input data-day type="number" min="1" value="${gameState.day}"> 日</label>
        <label>时 <input data-hour type="number" min="0" max="23" value="${hour}"></label>
        <label>分 <input data-minute type="number" min="0" max="59" value="${minute}"></label>
        <label>地点 <select data-location><option value="work" ${gameState.location === "work" ? "selected" : ""}>工作</option><option value="dorm" ${gameState.location === "dorm" ? "selected" : ""}>宿舍</option></select></label>
        <div>${button("应用时间", "apply-time")} <span>当前总分钟：${total}</span></div>
      </section>
      <section class="dev-section"><h3>玩家数值</h3>
        ${stats.map((stat) => `<label>${stat} <input data-stat="${stat}" type="number" min="0" max="${stat === "satiety" ? 255 : 100}" value="${gameState[stat]}"> ${button("−", `stat-minus-${stat}`)} ${button("＋", `stat-plus-${stat}`)}</label>`).join("")}
        <div>${button("应用数值", "apply-stats")}</div>
      </section>
      <section class="dev-section"><h3>当前数据文件</h3><p class="dev-current-file">${scheduleData.fileNameFor(gameState.day, gameState.phase)}</p></section>
    `);
  }

  showInventory() {
    const defs = itemManager.allDefIds().map((id) => {
      const def = itemManager.getDef(id);
      return `<option value="${id}">${def.name || id} (${id})</option>`;
    }).join("");
    this.panel(`<section class="dev-section"><h3>物品背包</h3>
      <div class="dev-inventory-add"><select data-item-id>${defs}</select><input data-item-count type="number" min="1" value="1">${button("增加", "add-item")}</div>
      <table class="dev-table"><thead><tr><th>物品</th><th>ID</th><th>数量</th><th>操作</th></tr></thead><tbody>
      ${itemManager.all().map(({ id, count, def }) => `<tr><td>${def.name}</td><td>${id}</td><td>${count}</td><td>${button("−1", `remove-item-${id}`)} ${button("清空", `clear-item-${id}`)}</td></tr>`).join("") || "<tr><td colspan=4>背包为空</td></tr>"}
      </tbody></table></section>`);
  }

  async loadDoc(fileName) {
    if (!this.docs.has(fileName)) this.docs.set(fileName, clone(await dataLoader.loadJSON(fileName)));
    return this.docs.get(fileName);
  }

  async showJson(fileName = this.selectedFile) {
    this.selectedFile = fileName;
    const doc = await this.loadDoc(fileName);
    this.panel(`<section class="dev-section"><h3>JSON 编辑器</h3>
      <label>文件 <select data-json-file>${JSON_FILES().map((file) => `<option ${file === fileName ? "selected" : ""}>${file}</option>`).join("")}</select></label>
      <textarea data-json-editor class="dev-textarea dev-json-editor">${JSON.stringify(doc, null, 2)}</textarea>
      <div>${button("校验并保存到内存", "save-json")} ${button("下载 JSON", "download-json")}</div>
    </section>`);
  }

  async showActorEditor(type = this.actorType) {
    this.actorType = type;
    const doc = await this.loadDoc(this.actorFile);
    const actors = doc[type] || [];
    if (!actors.some((actor) => actor.id === this.actorId)) this.actorId = actors[0]?.id || "";
    const actor = actors.find((entry) => entry.id === this.actorId) || {};
    const keywordDoc = await this.loadDoc("keywords.json");
    const keywordButtons = (keywordDoc.keywords || []).map((keyword) => `<button type="button" class="win95-btn dev-btn" data-keyword-insert="${keyword.id}">${keyword.label || keyword.id}</button>`).join("");
    this.panel(`<section class="dev-section"><h3>${type === "patients" ? "患者编辑器" : "对话编辑器"}</h3>
      <div class="dev-editor-selects"><label>文件 <select data-actor-file>${DAY_FILES().map((file) => `<option ${file === this.actorFile ? "selected" : ""}>${file}</option>`).join("")}</select></label>
      <label>角色 <select data-actor-id>${actors.map((entry) => `<option value="${entry.id}" ${entry.id === this.actorId ? "selected" : ""}>${entry.name || entry.id}</option>`).join("")}</select></label></div>
      <p>可编辑角色名称、关键词字段、对话文本、选项和 onShow 效果；保存后可下载整个日程文件。</p>
      <div class="dev-keyword-palette"><strong>插入关键词：</strong>${keywordButtons || "暂无关键词"}</div>
      <textarea data-actor-editor class="dev-textarea dev-actor-editor">${JSON.stringify(actor, null, 2)}</textarea>
      <div>${button("保存角色到内存", "save-actor")} ${button("下载日程 JSON", "download-actor-file")}</div>
    </section>`);
  }

  async showChatgtp() {
    await this.showJson("chatgtp_qa.json");
  }

  async handle(action) {
    if (action === "tab-state") return this.showState();
    if (action === "tab-inventory") return this.showInventory();
    if (action === "tab-dialogue") return this.showActorEditor("contacts");
    if (action === "tab-patient") return this.showActorEditor("patients");
    if (action === "tab-chatgtp") return this.showChatgtp();
    if (action === "tab-json") return this.showJson();
    if (action === "load-save") {
      const raw = this.root.querySelector("[data-save-input]").value.trim().replace(/^\?/, "");
      const ok = raw && saveManager.loadFromString(raw, { updateLocation: false });
      this.setStatus(ok ? "存档已载入，地址栏未改变。" : "存档字符串无效。", !ok);
      if (ok) this.showState();
      return;
    }
    if (action === "apply-time") {
      const day = Math.max(1, Number(this.root.querySelector("[data-day]").value) || 1);
      const hour = Math.min(23, Math.max(0, Number(this.root.querySelector("[data-hour]").value) || 0));
      const minute = Math.min(59, Math.max(0, Number(this.root.querySelector("[data-minute]").value) || 0));
      const clock = hour * 60 + minute;
      const derived = phaseForClock(clock);
      gameState.restore({ day, phase: derived.phase, location: this.root.querySelector("[data-location]").value });
      actionBudget.phaseMinutes = derived.phaseMinutes;
      eventBus.emit("actionBudget:changed", actionBudget.snapshot());
      eventBus.emit("daynight:changed", { phase: derived.phase, day, phaseChanged: false, developer: true });
      this.setStatus(`时间已调整为第 ${day} 日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}，数据文件 ${scheduleData.fileNameFor(day, derived.phase)}。`);
      return this.showState();
    }
    if (action === "apply-stats") {
      const changes = {};
      ["energy", "mental", "physical", "satiety"].forEach((stat) => { changes[stat] = Number(this.root.querySelector(`[data-stat="${stat}"]`).value) - gameState[stat]; });
      gameState.modify(changes);
      this.setStatus("玩家数值已应用。");
      return this.showState();
    }
    const statMatch = action.match(/^stat-(minus|plus)-(.+)$/);
    if (statMatch) {
      const input = this.root.querySelector(`[data-stat="${statMatch[2]}"]`);
      input.value = Number(input.value) + (statMatch[1] === "plus" ? 1 : -1);
      return;
    }
    const itemMatch = action.match(/^(remove|clear)-item-(.+)$/);
    if (itemMatch) { itemManager.remove(itemMatch[2], itemMatch[1] === "clear" ? itemManager.count(itemMatch[2]) : 1); return this.showInventory(); }
    if (action === "add-item") { itemManager.add(this.root.querySelector("[data-item-id]").value, Math.max(1, Number(this.root.querySelector("[data-item-count]").value) || 1)); return this.showInventory(); }
    if (action === "save-json") {
      try { this.docs.set(this.selectedFile, JSON.parse(this.root.querySelector("[data-json-editor]").value)); this.setStatus(`${this.selectedFile} 已校验并保存到内存。`); }
      catch (err) { this.setStatus(`JSON 无效：${err.message}`, true); }
      return;
    }
    if (action === "download-json") {
      const raw = this.root.querySelector("[data-json-editor]").value;
      try { const value = JSON.parse(raw); this.docs.set(this.selectedFile, value); downloadJson(this.selectedFile, value); this.setStatus(`${this.selectedFile} 已下载。`); }
      catch (err) { this.setStatus(`JSON 无效，无法下载：${err.message}`, true); }
      return;
    }
    if (action === "save-actor") {
      try {
        const value = JSON.parse(this.root.querySelector("[data-actor-editor]").value);
        const doc = await this.loadDoc(this.actorFile);
        const index = (doc[this.actorType] || []).findIndex((entry) => entry.id === this.actorId);
        if (index < 0) throw new Error("角色不存在");
        doc[this.actorType][index] = value;
        this.docs.set(this.actorFile, doc);
        this.setStatus(`${this.actorFile} 的 ${this.actorId} 已保存到内存。`);
      } catch (err) { this.setStatus(`角色 JSON 无效：${err.message}`, true); }
      return;
    }
    if (action === "download-actor-file") { const doc = await this.loadDoc(this.actorFile); downloadJson(this.actorFile, doc); this.setStatus(`${this.actorFile} 已下载。`); return; }
  }
}
// DEV-TOOLS:END
