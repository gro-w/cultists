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
import { DevItemEditorTab } from "./DevItemEditorTab.js";
import { DevDialogueEditorTab } from "./DevDialogueEditorTab.js";
import { DevBgmEditorTab } from "./DevBgmEditorTab.js";
import { DevLocationEditorTab } from "./DevLocationEditorTab.js";
import { DevDormComputerTab } from "./DevDormComputerTab.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const DAY_FILES = () => Array.from({ length: Math.min(MAX_GAME_DAYS, scheduleData.totalDays) }, (_, i) => ["work", "social"].flatMap((queue) => [`${queue}${String(i + 1).padStart(2, "0")}a.json`, `${queue}${String(i + 1).padStart(2, "0")}b.json`])).flat();
const JSON_FILES = () => [...DAY_FILES(), "socialpub.json", "workpub.json", "chatgtp_qa.json", "keywords.json", "npcs.json", "special_events.json", "items.json", "diagnoses.json", "medicines.json", "endings.json", "npc_state.json", "global_variables.json", "locations.json", "social_apps.json"];
const QA_PAGE_SIZE = 50;
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
function downloadJson(fileName, value) { const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); }
function clockParts() { const total = dayNightSystem.currentClockMinutes(); return { total, hour: Math.floor(total / 60), minute: total % 60 }; }
function phaseForClock(total) { const normalized = ((total % 1440) + 1440) % 1440; return normalized >= 480 && normalized < 960 ? { phase: "day", phaseMinutes: normalized - 480 } : { phase: "night", phaseMinutes: normalized >= 960 ? normalized - 960 : normalized + 480 }; }

export function launchDeveloperMode() {
  eventBus.emit("developer:opened", {});
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

class DeveloperMode {
  constructor(root, win) { this.root = root; this.win = win; this.docs = new Map(); this.selectedFile = "chatgtp_qa.json"; this.qaDraft = null; this.qaPage = 1; this.qaCategory = ""; this._devServerActive = false; this._sse = null; this._itemEditorTab = null; this._dialogueEditorTab = null; this._bgmEditorTab = null; this._locationEditorTab = null; this._dormComputerTab = null; this.render(); }
  render() {
    this.root.innerHTML = `<div class="dev-toolbar">${button("状态调节", "tab-state")}${button("NPC 状态调节", "tab-npc-state")}${button("背包", "tab-inventory")}${button("关键词编辑器", "tab-keywords")}${button("ChatGTP 编辑器", "tab-chatgtp")}${button("NPC 列表", "tab-npcs")}${button("全局变量", "tab-global-variables")}${button("JSON 文件", "tab-json")}${button("物品编辑器", "tab-item-editor", "dev-btn-tool")}${button("日程编辑器", "tab-dialogue-editor", "dev-btn-tool")}${button("🎵 BGM 编辑器", "tab-bgm-editor", "dev-btn-tool")}${button("📍 位置编辑器", "tab-location-editor", "dev-btn-tool")}${button("💻 电脑内容编辑器", "tab-dorm-computer", "dev-btn-tool")}</div><div class="dev-status" data-dev-status>开发工具就绪。修改仅存在于当前页面，使用下载按钮导出。</div><div class="dev-panel" data-dev-panel></div>`;
    this.bindPanel(); this.showState();
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

  bindPanel() { this.root.querySelectorAll("[data-dev-action]").forEach((el) => el.addEventListener("click", () => this.handle(el.dataset.devAction))); }
  panel(html) {
    this.root.querySelector("[data-dev-panel]").innerHTML = html;
    this.bindPanel();
    const jsonFile = this.root.querySelector("[data-json-file]");
    if (jsonFile) jsonFile.addEventListener("change", () => this.showJson(jsonFile.value));

  }

  /** Unmount any active editor tab (item / dialogue / bgm / location / dormComputer) before switching panels. */
  _unmountEditorTabs() {
    if (this._dialogueEditorTab) { this._dialogueEditorTab.unmount(); this._dialogueEditorTab = null; }
    if (this._bgmEditorTab) { this._bgmEditorTab.unmount(); this._bgmEditorTab = null; }
    if (this._locationEditorTab) { this._locationEditorTab.unmount(); this._locationEditorTab = null; }
    if (this._dormComputerTab) { this._dormComputerTab.unmount(); this._dormComputerTab = null; }
    // item editor has no document-level listeners, no explicit unmount needed
    this._itemEditorTab = null;
  }

  showItemEditor() {
    this._unmountEditorTabs();
    this._itemEditorTab = new DevItemEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._itemEditorTab.html();
    this.bindPanel();
    this._itemEditorTab.mount();
  }

  showDialogueEditor() {
    this._unmountEditorTabs();
    this._dialogueEditorTab = new DevDialogueEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._dialogueEditorTab.html();
    this.bindPanel();
    this._dialogueEditorTab.mount(this.root.querySelector(".dev-de-root"));
  }

  showBgmEditor() {
    this._unmountEditorTabs();
    this._bgmEditorTab = new DevBgmEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._bgmEditorTab.html();
    this.bindPanel();
    this._bgmEditorTab.mount();
  }

  showLocationEditor() {
    this._unmountEditorTabs();
    this._locationEditorTab = new DevLocationEditorTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._locationEditorTab.html();
    this.bindPanel();
    this._locationEditorTab.mount();
  }

  showDormComputerEditor() {
    this._unmountEditorTabs();
    this._dormComputerTab = new DevDormComputerTab(this);
    this.root.querySelector("[data-dev-panel]").innerHTML = this._dormComputerTab.html();
    this.bindPanel();
    this._dormComputerTab.mount();
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
        <div>${button("应用时间", "apply-time")} ${button("强制下班（忽略阻塞）", "force-end-work")} <span>当前总分钟：${total}</span></div>
      </section>
      <section class="dev-section"><h3>玩家数值</h3>
        ${stats.map((stat) => `<label>${stat} <input data-stat="${stat}" type="number" min="0" max="${stat === "satiety" ? 255 : 100}" value="${gameState[stat]}"> ${button("−", `stat-minus-${stat}`)} ${button("＋", `stat-plus-${stat}`)}</label>`).join("")}
        <div>${button("应用数值", "apply-stats")}</div>
      </section>
      <section class="dev-section"><h3>当前数据文件</h3><p class="dev-current-file">${scheduleData.fileNameFor(gameState.day, gameState.phase)}</p></section>
    `);
  }

  showNpcState() {
    const actors = [{ id: "chatgtp", name: "ChatGTP", favorability: null }, ...npcStateManager.npcs.map((npc) => ({ id: npc.id, name: npc.name, favorability: favorabilityManager.get(npc.id) }))];
    const rows = actors.map((actor) => `<tr data-npc-state-row="${esc(actor.id)}"><td>${esc(actor.name)}<br><code>${esc(actor.id)}</code></td><td><input data-npc-san type="number" min="0" max="100" value="${npcStateManager.get(actor.id)}"></td><td>${actor.favorability == null ? "—" : `<input data-npc-favor type="number" min="0" max="100" value="${actor.favorability}">`}</td><td>${npcStateManager.isOffline(actor.id) ? "离线" : npcStateManager.isDistressed(actor.id) ? "不稳定" : "在线"}</td></tr>`).join("");
    const hisProgress = dialogueProgress.get("his");
    const socialProgress = dialogueProgress.get("social");
    const chatgtpProgress = dialogueProgress.get("chatgtp");
    this.panel(`<section class="dev-section"><h3>NPC 状态调节器</h3><p>直接设置 NPC 或 ChatGTP 的 SAN、好感度和在线状态。设置 SAN 时会清除此前的离线标记，除非勾选离线。</p><table class="dev-table"><thead><tr><th>角色</th><th>SAN</th><th>好感度</th><th>当前状态</th></tr></thead><tbody>${rows}</tbody></table><label><input data-force-offline type="checkbox"> 将 SAN 不高于离线阈值的角色强制设为离线</label><div>${button("应用 NPC 状态", "apply-npc-state")}</div></section><section class="dev-section"><h3>对话状态调节器</h3><p>设置后，重新打开对应应用时会从指定角色和节点继续。</p><label>应用 <select data-dialogue-app><option value="his">HIS</option><option value="social">Social</option><option value="chatgtp">ChatGTP</option></select></label><label>角色 ID <input data-dialogue-actor value="${esc(hisProgress.actorId || "")}" placeholder="例如 ajie"></label><label>节点 ID <input data-dialogue-node value="${esc(hisProgress.nodeId || "")}" placeholder="例如 start"></label><div>${button("应用对话状态", "apply-dialogue-state")} ${button("清除对话状态", "clear-dialogue-state")}</div><p class="dev-current-file">当前 HIS：${esc(hisProgress.actorId || "无")} / ${esc(hisProgress.nodeId || "无")}；Social：${esc(socialProgress.actorId || "无")} / ${esc(socialProgress.nodeId || "无")}；ChatGTP：${esc(chatgtpProgress.nodeId || "无")}</p></section>`);
    const appSelect = this.root.querySelector("[data-dialogue-app]");
    appSelect.addEventListener("change", () => {
      const progress = dialogueProgress.get(appSelect.value);
      this.root.querySelector("[data-dialogue-actor]").value = progress.actorId || (appSelect.value === "chatgtp" ? "chatgtp" : "");
      this.root.querySelector("[data-dialogue-node]").value = progress.nodeId || "";
    });
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
      <div>${button("校验并保存到内存", "save-json")} ${button("下载 JSON", "download-json")} ${button("写入磁盘", "write-json")}</div>
    </section>`);
  }



  async showKeywords() {
    const doc = await this.loadDoc("keywords.json");
    const rows = (doc.keywords || []).map((k, i) => `<tr data-keyword-row="${i}"><td><input data-k-id value="${esc(k.id)}"></td><td><input data-k-content value="${esc(k.content || k.label || "")}"></td><td>${button("删除", `remove-keyword-${i}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>关键词编辑器</h3><p>关键词只保存稳定 ID 和显示内容。疾病关键词的介绍、药物和秘药资料请在 ChatGTP 编辑器中修改。</p><table class="dev-table dev-keyword-table"><thead><tr><th>ID</th><th>内容</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增关键词", "add-keyword")} ${button("保存关键词到内存", "save-keywords")} ${button("下载 keywords.json", "download-keywords")} ${button("写入磁盘", "write-keywords")}</div></section>`);
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
    this.panel(`<section class="dev-section"><h3>ChatGTP 问答编辑器</h3><p>先按关键词类别筛选，再为每条问答选择两个关键词。列表每页最多显示 ${QA_PAGE_SIZE} 条，避免一次创建数万条编辑 DOM。</p><label>关键词类别 <select data-qa-category>${categoryOptions}</select></label><span>当前显示 ${page.length} / ${filtered.length} 条（总计 ${this.qaDraft.length} 条）</span><div class="dev-qa-list">${rows || "暂无符合条件的问答条目"}</div><div>${button("上一页", "qa-page-prev")} <span>第 ${this.qaPage} / ${totalPages} 页</span> ${button("下一页", "qa-page-next")} ${button("新增问答", "add-qa-entry")} ${button("保存问答到内存", "save-qa")} ${button("下载 chatgtp_qa.json", "download-qa")} ${button("写入磁盘", "write-qa")}</div></section>`);
    this.root.querySelector("[data-qa-category]")?.addEventListener("change", (event) => { this._syncQaPage(); this.qaCategory = event.target.value; this.qaPage = 1; this.showChatgtp(); });
    this.root.querySelectorAll("[data-qa-same]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      checkbox.closest("[data-qa-entry]").querySelector("[data-qa-corrupted]").disabled = checkbox.checked;
    }));
  }


  async showNpcs() {
    const doc = await this.loadDoc("npcs.json");
    const rows = (doc.npcs || []).map((npc, index) => `<tr data-npc-row="${index}"><td><input data-npc-id value="${esc(npc.id)}"></td><td><input data-npc-name value="${esc(npc.name)}"></td><td><input data-npc-avatar value="${esc(npc.avatar || "🙂")}"></td><td><input data-npc-favor type="number" min="0" max="100" value="${Number(npc.initialFavorability) || 0}"></td><td><input data-npc-san type="number" min="0" max="100" value="${Number(npc.initialSan) || 0}"></td><td>${button("删除", `remove-npc-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>NPC 列表</h3><p>维护特殊事件使用的稳定 NPC ID、名字、头像、初始好感度和初始 SAN。主角对话节点可通过 <code>onShow.favorabilityChange</code> 改变好感度。</p><table class="dev-table"><thead><tr><th>ID</th><th>名字</th><th>头像</th><th>初始好感度</th><th>初始 SAN</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增 NPC", "add-npc")} ${button("保存 NPC 到内存", "save-npcs")} ${button("下载 npcs.json", "download-npcs")} ${button("写入磁盘", "write-npcs")}</div></section>`);
  }

  showGlobalVariables() {
    const valueText = (variable, value) => variable.type === "string" ? value : String(value);
    const rows = globalVariableManager.all().map((variable, index) => `<tr data-global-variable-row="${index}"><td><input data-gv-id type="number" min="0" step="1" value="${variable.id}"></td><td><input data-gv-name value="${esc(variable.name)}"></td><td><select data-gv-type><option value="bool" ${variable.type === "bool" ? "selected" : ""}>bool</option><option value="number" ${variable.type === "number" ? "selected" : ""}>0-256 数字</option><option value="string" ${variable.type === "string" ? "selected" : ""}>字符串</option></select></td><td><input data-gv-default value="${esc(valueText(variable, variable.default))}"></td><td><input data-gv-value value="${esc(valueText(variable, variable.value))}"></td><td>${button("删除", `remove-global-variable-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>全局变量编辑器</h3><p>全局变量由 ID、名称和类型定义。对话节点/选项可使用 <code>condition: { id, op, value }</code>，节点副作用可使用 <code>onShow.globalVariables: [{ id, value }]。</code> 修改只存在于当前页面；请下载 JSON 保存到项目。</p><table class="dev-table dev-global-variable-table"><thead><tr><th>ID</th><th>名称</th><th>类型</th><th>默认值</th><th>当前值</th><th>操作</th></tr></thead><tbody>${rows || "<tr><td colspan=6>暂无全局变量</td></tr>"}</tbody></table><div>${button("新增变量", "add-global-variable")} ${button("保存到内存", "save-global-variables")} ${button("下载 global_variables.json", "download-global-variables")} ${button("写入磁盘", "write-global-variables")}</div></section>`);
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


  async handle(action) {
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

    if (action === "tab-json") { this._unmountEditorTabs(); return this.showJson(); }
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
    if (action === "apply-time") {
      const day = Math.max(1, Number(this.root.querySelector("[data-day]").value) || 1);
      const hour = Math.min(23, Math.max(0, Number(this.root.querySelector("[data-hour]").value) || 0));
      const minute = Math.min(59, Math.max(0, Number(this.root.querySelector("[data-minute]").value) || 0));
      const clock = hour * 60 + minute;
      const adjusted = timeService.debugSetTime(day, clock, this.root.querySelector("[data-location]").value);
      this.setStatus(`时间已调整为第 ${day} 日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}，数据文件 ${scheduleData.fileNameFor(day, adjusted.phase)}。`);
      return this.showState();
    }
    if (action === "force-end-work") {
      const result = dayNightSystem.forceEndWork();
      this.setStatus(result.ok
        ? "已强制下班，忽略未完成工作阻塞。"
        : "强制下班失败：当前不在工作值班状态。", !result.ok);
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
      this.setStatus("NPC 与 ChatGTP 状态已应用。");
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
    if (action === "save-json") {
      try {
        const value = JSON.parse(this.root.querySelector("[data-json-editor]").value);
        if (this.selectedFile === "global_variables.json") {
          const variables = Array.isArray(value) ? value : value.variables;
          globalVariableManager.replaceDefinitions(Array.isArray(variables) ? variables : []);
          this.docs.set(this.selectedFile, Array.isArray(variables) ? variables : []);
        } else {
          this.docs.set(this.selectedFile, value);
        }
        this.setStatus(`${this.selectedFile} 已校验并保存到内存。`);
      }
      catch (err) { this.setStatus(`JSON 无效：${err.message}`, true); }
      return;
    }
    if (action === "download-json") {
      const raw = this.root.querySelector("[data-json-editor]").value;
      try { const value = JSON.parse(raw); this.docs.set(this.selectedFile, value); downloadJson(this.selectedFile, value); this.setStatus(`${this.selectedFile} 已下载。`); }
      catch (err) { this.setStatus(`JSON 无效，无法下载：${err.message}`, true); }
      return;
    }
    if (action === "write-json") {
      const raw = this.root.querySelector("[data-json-editor]").value;
      let value; try { value = JSON.parse(raw); } catch (err) { this.setStatus(`JSON 无效，无法写入磁盘：${err.message}`, true); return; }
      this.docs.set(this.selectedFile, value); await this.writeToDisk(this.selectedFile, value); return;
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
