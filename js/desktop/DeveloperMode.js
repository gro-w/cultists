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
import { npcStateManager } from "../core/NpcStateManager.js";
import { favorabilityManager } from "../core/FavorabilityManager.js";
import { dialogueProgress } from "../core/DialogueProgress.js";
import { globalVariableManager } from "../core/GlobalVariableManager.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const DAY_FILES = () => Array.from({ length: scheduleData.totalDays }, (_, i) => ["work", "social"].flatMap((queue) => [`${queue}${String(i + 1).padStart(2, "0")}a.json`, `${queue}${String(i + 1).padStart(2, "0")}b.json`])).flat();
const JSON_FILES = () => [...DAY_FILES(), "chatgtp_qa.json", "keywords.json", "npcs.json", "special_events.json", "items.json", "diagnoses.json", "medicines.json", "endings.json", "npc_state.json", "global_variables.json"];
const button = (text, action, className = "") => `<button type="button" class="win95-btn dev-btn ${className}" data-dev-action="${action}">${text}</button>`;
function downloadJson(fileName, value) { const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); }
function clockParts() { const total = dayNightSystem.currentClockMinutes(); return { total, hour: Math.floor(total / 60), minute: total % 60 }; }
function phaseForClock(total) { const normalized = ((total % 1440) + 1440) % 1440; return normalized >= 480 && normalized < 960 ? { phase: "day", phaseMinutes: normalized - 480 } : { phase: "night", phaseMinutes: normalized >= 960 ? normalized - 960 : normalized + 480 }; }

export function launchDeveloperMode() {
  const existing = windowManager.getByAppId("developer-mode");
  if (existing) { windowManager.focus(existing.id); return; }
  const root = document.createElement("div"); root.className = "developer-mode-root";
  const win = windowManager.createWindow({ appId: "developer-mode", title: "开发人员模式", icon: "🛠️", width: 900, height: 680, content: root });
  new DeveloperMode(root, win);
}

class DeveloperMode {
  constructor(root, win) { this.root = root; this.win = win; this.docs = new Map(); this.selectedFile = "chatgtp_qa.json"; this.actorFile = DAY_FILES()[0] || "day01a.json"; this.actorType = "contacts"; this.actorId = ""; this.actorTreeDraft = null; this.activeText = null; this.render(); }
  render() {
    this.root.innerHTML = `<div class="dev-toolbar">${button("状态调节", "tab-state")}${button("NPC 状态调节", "tab-npc-state")}${button("背包", "tab-inventory")}${button("对话分支树", "tab-dialogue")}${button("患者分支树", "tab-patient")}${button("关键词编辑器", "tab-keywords")}${button("ChatGTP 编辑器", "tab-chatgtp")}${button("NPC 列表", "tab-npcs")}${button("全局变量", "tab-global-variables")}${button("JSON 文件", "tab-json")}</div><div class="dev-status" data-dev-status>开发工具就绪。修改仅存在于当前页面，使用下载按钮导出。</div><div class="dev-panel" data-dev-panel></div>`;
    this.bindPanel(); this.showState();
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
    const actorFile = this.root.querySelector("[data-actor-file]");
    if (actorFile) actorFile.addEventListener("change", () => { this.actorFile = actorFile.value; this.actorId = ""; this.actorTreeDraft = null; this.showActorEditor(); });
    const actorId = this.root.querySelector("[data-actor-id]");
    if (actorId) actorId.addEventListener("change", () => { this.actorId = actorId.value; this.actorTreeDraft = null; this.showActorEditor(); });
    this.root.querySelectorAll("[data-keyword-insert]").forEach((el) => el.addEventListener("click", () => {
      const editor = this.activeText || this.root.querySelector("[data-actor-editor]");
      if (!editor) return;
      const marker = `[[${el.dataset.keywordInsert}]]`;
      const start = editor.selectionStart;
      editor.value = `${editor.value.slice(0, start)}${marker}${editor.value.slice(editor.selectionEnd)}`;
      editor.selectionStart = editor.selectionEnd = start + marker.length;
      editor.focus();
    }));
    this.root.querySelectorAll("[data-tree-text]").forEach((el) => el.addEventListener("focus", () => { this.activeText = el; }));
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
      <div>${button("校验并保存到内存", "save-json")} ${button("下载 JSON", "download-json")}</div>
    </section>`);
  }

  keywordPalette(keywordDoc) { return `<div class="dev-keyword-palette"><strong>关键词（点击插入，显示 ID / 内容）：</strong>${(keywordDoc.keywords || []).map((k) => `<button type="button" class="win95-btn dev-keyword-chip" data-keyword-insert="${esc(k.id)}">${esc(k.content || k.label || k.id)} <code>${esc(k.id)}</code></button>`).join("") || "暂无关键词"}</div>`; }

  treeHtml(tree, keywordDoc) {
    const nodes = tree?.nodes || {};
    const nodeIds = Object.keys(nodes);
    const cards = nodeIds.map((id, index) => {
      const node = nodes[id] || {};
      const options = (node.options || []).map((option, optionIndex) => `<div class="dev-tree-option"><input data-option-label="${esc(id)}" data-option-index="${optionIndex}" value="${esc(option.label)}" placeholder="选项文本"><span>→</span><select data-option-next="${esc(id)}" data-option-index="${optionIndex}">${nodeIds.map((target) => `<option value="${esc(target)}" ${target === option.next ? "selected" : ""}>${esc(target)}</option>`).join("")}</select>${button("删除", `remove-option-${index}-${optionIndex}`)}</div>`).join("");
      return `<article class="dev-tree-node" data-node-id="${esc(id)}"><header><strong>${index + 1}. ${esc(id)}</strong>${id === tree.start ? " <em>起点</em>" : ""}${button("删除节点", `remove-node-${index}`)}</header><label>说话者 <select data-node-speaker="${esc(id)}"><option value="npc" ${node.speaker === "npc" ? "selected" : ""}>NPC</option><option value="player" ${node.speaker === "player" ? "selected" : ""}>玩家</option></select></label><label>内容<textarea data-tree-text data-node-text="${esc(id)}" rows="3">${esc(node.text)}</textarea></label><div class="dev-tree-options"><strong>分支选项</strong>${options || "<span>无分支（终点）</span>"}${button("新增选项", `add-option-${index}`)}</div></article>`;
    }).join("");
    const startOptions = nodeIds.map((id) => `<option value="${esc(id)}" ${id === tree.start ? "selected" : ""}>${esc(id)}</option>`).join("");
    return `<section class="dev-tree"><div class="dev-tree-map"><strong>对话分支树</strong><p>起点：<select data-tree-start>${startOptions}</select>；每张卡片是一个节点，箭头表示选项跳转。</p>${cards || "暂无节点"}${button("新增节点", "add-node")}</div>${this.keywordPalette(keywordDoc)}</section>`;
  }

  async showActorEditor(type = this.actorType) {
    this.actorType = type;
    const doc = await this.loadDoc(this.actorFile);
    const actors = doc[type] || [];
    if (!actors.some((actor) => actor.id === this.actorId)) this.actorId = actors[0]?.id || "";
    const actor = actors.find((entry) => entry.id === this.actorId) || {};
    const keywordDoc = await this.loadDoc("keywords.json");
    const npcDoc = type === "contacts" ? await this.loadDoc("npcs.json") : { npcs: [] };
    const npcOptions = (npcDoc.npcs || []).map((npc) => `<option value="${esc(npc.id)}" ${actor.npcId === npc.id ? "selected" : ""}>${esc(npc.name)} (${esc(npc.id)})</option>`).join("");
    const tree = this.actorTreeDraft || actor.dialogueTree || { start: "start", nodes: { start: { speaker: "npc", text: "", options: [] } } };
    this.panel(`<section class="dev-section"><h3>${type === "patients" ? "患者编辑器" : "对话编辑器"}</h3>
      <div class="dev-editor-selects"><label>文件 <select data-actor-file>${DAY_FILES().map((file) => `<option ${file === this.actorFile ? "selected" : ""}>${file}</option>`).join("")}</select></label>
      <label>角色 <select data-actor-id>${actors.map((entry) => `<option value="${entry.id}" ${entry.id === this.actorId ? "selected" : ""}>${entry.name || npcDoc.npcs?.find((npc) => npc.id === entry.npcId)?.name || entry.id}</option>`).join("")}</select></label></div>
      <div class="dev-actor-actions"><label>新${type === "patients" ? "患者" : "角色"} ID <input data-new-actor-id placeholder="例如 new_${type === "patients" ? "patient" : "contact"}"></label><label>名称 <input data-new-actor-name placeholder="显示名称"></label>${button(`新增${type === "patients" ? "患者" : "角色"}`, "add-actor")}${this.actorId ? button(`删除当前${type === "patients" ? "患者" : "角色"}`, "delete-actor") : ""}</div>
      <p>这是可视化分支树：节点内容、说话者、选项文本和箭头目标均可直接编辑。关键词按钮会插入当前聚焦节点。</p>
      <div class="dev-actor-meta">${type === "patients" ? `<label>角色名称 <input data-actor-name value="${esc(actor.name)}"></label>` : `<label>角色类型 <select data-actor-kind><option value="npc" ${actor.npcId ? "selected" : ""}>NPC 列表角色</option><option value="other" ${!actor.npcId ? "selected" : ""}>other（自定义角色）</option></select></label><label>NPC ID <select data-actor-npc-id><option value="">（选择 NPC）</option>${npcOptions}</select></label><label>自定义名称 <input data-actor-name value="${esc(actor.name)}" placeholder="仅 other 使用"></label><label>自定义头像 <input data-actor-avatar value="${esc(actor.avatar)}" placeholder="仅 other 使用"></label>`}</div>
      ${this.treeHtml(tree, keywordDoc)}
      <div>${button("保存角色到内存", "save-actor")} ${button("下载日程 JSON", "download-actor-file")}</div>
    </section>`);
  }

  async showKeywords() {
    const doc = await this.loadDoc("keywords.json");
    const rows = (doc.keywords || []).map((k, i) => `<tr data-keyword-row="${i}"><td><input data-k-id value="${esc(k.id)}"></td><td><input data-k-content value="${esc(k.content || k.label || "")}"></td><td>${button("删除", `remove-keyword-${i}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>关键词编辑器</h3><p>关键词只保存稳定 ID 和显示内容。疾病关键词的介绍、药物和秘药资料请在 ChatGTP 编辑器中修改。</p><table class="dev-table dev-keyword-table"><thead><tr><th>ID</th><th>内容</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增关键词", "add-keyword")} ${button("保存关键词到内存", "save-keywords")} ${button("下载 keywords.json", "download-keywords")}</div></section>`);
  }

  async showChatgtp() {
    const qa = await this.loadDoc("chatgtp_qa.json");
    const keywords = await this.loadDoc("keywords.json");

    const rows = (qa.entries || []).map((entry, index) => {
      const selected = (entry.keywords || []).map((value) => {
        const keyword = (keywords.keywords || []).find((item) => item.id === value || item.content === value || item.label === value);
        return keyword?.id || value;
      });
      const option = (slot) => `<select data-qa-keyword="${index}" data-qa-slot="${slot}"><option value="">（不选择）</option>${(keywords.keywords || []).map((keyword) => `<option value="${esc(keyword.id)}" ${selected[slot] === keyword.id ? "selected" : ""}>${esc(keyword.content || keyword.label || keyword.id)} (${esc(keyword.id)})</option>`).join("")}</select>`;
      const same = Boolean(entry.corruptedSameAsNormal);
      return `<article class="dev-qa-entry" data-qa-entry="${index}"><header><strong>${index + 1}. 关键词组合</strong>${option(0)} + ${option(1)}${button("删除", `remove-qa-entry-${index}`)}</header><label>正常回答<textarea data-qa-answer rows="3">${esc(entry.answer)}</textarea></label><label class="dev-checkbox-label"><input type="checkbox" data-qa-same ${same ? "checked" : ""}> SAN 较低时使用正常回答</label><label>损坏时回答<textarea data-qa-corrupted rows="3" ${same ? "disabled" : ""}>${esc(entry.corruptedAnswer || "")}</textarea></label></article>`;
    }).join("");
    this.panel(`<section class="dev-section"><h3>ChatGTP 问答编辑器</h3><p>所有关键词（包括疾病和疾病类别关键词）都使用同一套 1～2 个关键词问答字段。正常回答对应高 SAN，损坏回答对应低 SAN；疾病关键词的内容按既定规则预先写入这里。</p><div class="dev-qa-list">${rows || "暂无问答条目"}</div><div>${button("新增问答", "add-qa-entry")} ${button("保存问答到内存", "save-qa")} ${button("下载 chatgtp_qa.json", "download-qa")}</div></section>`);
    this.root.querySelectorAll("[data-qa-same]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      checkbox.closest("[data-qa-entry]").querySelector("[data-qa-corrupted]").disabled = checkbox.checked;
    }));
  }

  async showNpcs() {
    const doc = await this.loadDoc("npcs.json");
    const rows = (doc.npcs || []).map((npc, index) => `<tr data-npc-row="${index}"><td><input data-npc-id value="${esc(npc.id)}"></td><td><input data-npc-name value="${esc(npc.name)}"></td><td><input data-npc-avatar value="${esc(npc.avatar || "🙂")}"></td><td><input data-npc-favor type="number" min="0" max="100" value="${Number(npc.initialFavorability) || 0}"></td><td><input data-npc-san type="number" min="0" max="100" value="${Number(npc.initialSan) || 0}"></td><td>${button("删除", `remove-npc-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>NPC 列表</h3><p>维护特殊事件使用的稳定 NPC ID、名字、头像、初始好感度和初始 SAN。主角对话节点可通过 <code>onShow.favorabilityChange</code> 改变好感度。</p><table class="dev-table"><thead><tr><th>ID</th><th>名字</th><th>头像</th><th>初始好感度</th><th>初始 SAN</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><div>${button("新增 NPC", "add-npc")} ${button("保存 NPC 到内存", "save-npcs")} ${button("下载 npcs.json", "download-npcs")}</div></section>`);
  }

  showGlobalVariables() {
    const valueText = (variable, value) => variable.type === "string" ? value : String(value);
    const rows = globalVariableManager.all().map((variable, index) => `<tr data-global-variable-row="${index}"><td><input data-gv-id type="number" min="0" step="1" value="${variable.id}"></td><td><input data-gv-name value="${esc(variable.name)}"></td><td><select data-gv-type><option value="bool" ${variable.type === "bool" ? "selected" : ""}>bool</option><option value="number" ${variable.type === "number" ? "selected" : ""}>0-256 数字</option><option value="string" ${variable.type === "string" ? "selected" : ""}>字符串</option></select></td><td><input data-gv-default value="${esc(valueText(variable, variable.default))}"></td><td><input data-gv-value value="${esc(valueText(variable, variable.value))}"></td><td>${button("删除", `remove-global-variable-${index}`)}</td></tr>`).join("");
    this.panel(`<section class="dev-section"><h3>全局变量编辑器</h3><p>全局变量由 ID、名称和类型定义。对话节点/选项可使用 <code>condition: { id, op, value }</code>，节点副作用可使用 <code>onShow.globalVariables: [{ id, value }]。</code> 修改只存在于当前页面；请下载 JSON 保存到项目。</p><table class="dev-table dev-global-variable-table"><thead><tr><th>ID</th><th>名称</th><th>类型</th><th>默认值</th><th>当前值</th><th>操作</th></tr></thead><tbody>${rows || "<tr><td colspan=6>暂无全局变量</td></tr>"}</tbody></table><div>${button("新增变量", "add-global-variable")} ${button("保存到内存", "save-global-variables")} ${button("下载 global_variables.json", "download-global-variables")}</div></section>`);
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

  collectTree() {
    const nodes = {};
    this.root.querySelectorAll("[data-node-id]").forEach((card) => {
      const id = card.dataset.nodeId;
      const options = Array.from(card.querySelectorAll(".dev-tree-option")).map((row) => ({
        label: row.querySelector("[data-option-label]")?.value || "",
        next: row.querySelector("[data-option-next]")?.value || "",
      }));
      nodes[id] = { speaker: card.querySelector("[data-node-speaker]")?.value || "npc", text: card.querySelector("[data-node-text]")?.value || "", options };
    });
    return { start: this.root.querySelector("[data-tree-start]")?.value || Object.keys(nodes)[0] || "start", nodes };
  }

  async saveActorToMemory() {
    const doc = await this.loadDoc(this.actorFile);
    const index = (doc[this.actorType] || []).findIndex((entry) => entry.id === this.actorId);
    if (index < 0) throw new Error("角色不存在");
    const value = clone(doc[this.actorType][index]);
    if (this.actorType === "patients") {
      value.name = this.root.querySelector("[data-actor-name]")?.value || value.name;
    } else if (this.root.querySelector("[data-actor-kind]")?.value === "npc") {
      value.type = "npc";
      value.npcId = this.root.querySelector("[data-actor-npc-id]")?.value || "";
      delete value.name;
      delete value.avatar;
    } else {
      value.type = "other";
      delete value.npcId;
      value.name = this.root.querySelector("[data-actor-name]")?.value || "自定义角色";
      value.avatar = this.root.querySelector("[data-actor-avatar]")?.value || "🙂";
    }
    delete value.keywordIds;
    value.dialogueTree = this.collectTree();
    doc[this.actorType][index] = value;
    this.docs.set(this.actorFile, doc);
    this.actorTreeDraft = value.dialogueTree;
  }

  async handle(action) {
    if (action === "tab-state") return this.showState();
    if (action === "tab-inventory") return this.showInventory();
    if (action === "tab-npc-state") return this.showNpcState();
    if (action === "tab-dialogue") return this.showActorEditor("contacts");
    if (action === "tab-patient") return this.showActorEditor("patients");
    if (action === "tab-keywords") return this.showKeywords();
    if (action === "tab-chatgtp") return this.showChatgtp();
    if (action === "tab-npcs") return this.showNpcs();
    if (action === "tab-global-variables") return this.showGlobalVariables();
    if (action === "tab-json") return this.showJson();
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
    if (action === "save-global-variables" || action === "download-global-variables") {
      try {
        const variables = this._readGlobalVariableRows();
        globalVariableManager.replaceDefinitions(variables);
        variables.forEach((variable) => globalVariableManager.set(variable.id, variable.value));
        const doc = variables.map(({ id, name, type, default: defaultValue }) => ({ id, name, type, default: defaultValue }));
        this.docs.set("global_variables.json", doc);
        if (action === "download-global-variables") downloadJson("global_variables.json", doc);
        this.setStatus(`global_variables.json 已${action === "download-global-variables" ? "下载" : "保存到内存"}。`);
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
    if (action === "save-actor") {
      try { await this.saveActorToMemory(); this.setStatus(`${this.actorFile} 的 ${this.actorId} 已保存到内存。`); }
      catch (err) { this.setStatus(`角色保存失败：${err.message}`, true); }
      return;
    }
    if (action === "download-actor-file") { await this.saveActorToMemory(); const doc = await this.loadDoc(this.actorFile); downloadJson(this.actorFile, doc); this.setStatus(`${this.actorFile} 已下载。`); return; }
    if (action === "add-actor") {
      const id = this.root.querySelector("[data-new-actor-id]")?.value.trim();
      const name = this.root.querySelector("[data-new-actor-name]")?.value.trim() || id;
      const doc = await this.loadDoc(this.actorFile);
      const actors = doc[this.actorType] || (doc[this.actorType] = []);
      if (!id) { this.setStatus("新增失败：必须填写角色 ID。", true); return; }
      if (actors.some((actor) => actor.id === id)) { this.setStatus(`新增失败：ID ${id} 已存在。`, true); return; }
      const actor = { id, name, dialogueTree: { start: "start", nodes: { start: { speaker: "npc", text: "", options: [] } } } };
      if (this.actorType === "patients") Object.assign(actor, { age: 0 });
      else Object.assign(actor, { type: "other", avatar: "🙂" });
      actors.push(actor); this.docs.set(this.actorFile, doc); this.actorId = id; this.actorTreeDraft = null; this.setStatus(`${this.actorFile} 已新增${this.actorType === "patients" ? "患者" : "角色"} ${id}。`); return this.showActorEditor();
    }
    if (action === "delete-actor") {
      const doc = await this.loadDoc(this.actorFile);
      const actors = doc[this.actorType] || [];
      const index = actors.findIndex((actor) => actor.id === this.actorId);
      if (index < 0) { this.setStatus("删除失败：当前角色不存在。", true); return; }
      actors.splice(index, 1); this.docs.set(this.actorFile, doc); this.actorId = actors[Math.max(0, index - 1)]?.id || actors[0]?.id || ""; this.actorTreeDraft = null; this.setStatus(`已删除${this.actorType === "patients" ? "患者" : "角色"}。`); return this.showActorEditor();
    }
    if (action === "add-node") { const tree = this.collectTree(); let n = 1; while (tree.nodes[`new_node_${n}`]) n += 1; tree.nodes[`new_node_${n}`] = { speaker: "npc", text: "", options: [] }; this.replaceActorTree(tree); return; }
    const addOption = action.match(/^add-option-(\d+)$/);
    if (addOption) { const tree = this.collectTree(); const id = Object.keys(tree.nodes)[Number(addOption[1])]; if (id) tree.nodes[id].options.push({ label: "", next: tree.start }); this.replaceActorTree(tree); return; }
    const removeNode = action.match(/^remove-node-(\d+)$/);
    if (removeNode) { const tree = this.collectTree(); const id = Object.keys(tree.nodes)[Number(removeNode[1])]; if (id && Object.keys(tree.nodes).length > 1) { delete tree.nodes[id]; Object.values(tree.nodes).forEach((node) => node.options = node.options.filter((option) => option.next !== id)); if (tree.start === id) tree.start = Object.keys(tree.nodes)[0]; this.replaceActorTree(tree); } return; }
    const removeOption = action.match(/^remove-option-(\d+)-(\d+)$/);
    if (removeOption) { const tree = this.collectTree(); const id = Object.keys(tree.nodes)[Number(removeOption[1])]; if (id) tree.nodes[id].options.splice(Number(removeOption[2]), 1); this.replaceActorTree(tree); return; }
    const removeQa = action.match(/^remove-qa-entry-(\d+)$/);
    if (removeQa) { const qa = await this.loadDoc("chatgtp_qa.json"); qa.entries.splice(Number(removeQa[1]), 1); this.docs.set("chatgtp_qa.json", qa); return this.showChatgtp(); }
    const removeNpc = action.match(/^remove-npc-(\d+)$/);
    if (removeNpc) { const doc = await this.loadDoc("npcs.json"); doc.npcs.splice(Number(removeNpc[1]), 1); this.docs.set("npcs.json", doc); return this.showNpcs(); }
    if (action === "add-npc") { const doc = await this.loadDoc("npcs.json"); doc.npcs = doc.npcs || []; doc.npcs.push({ id: `new_npc_${doc.npcs.length + 1}`, name: "新 NPC", avatar: "🙂", initialFavorability: 50, initialSan: 80 }); this.docs.set("npcs.json", doc); return this.showNpcs(); }
    if (action === "save-npcs" || action === "download-npcs") {
      const doc = await this.loadDoc("npcs.json"); const rows = Array.from(this.root.querySelectorAll("[data-npc-row]")); const ids = rows.map((row) => row.querySelector("[data-npc-id]").value.trim());
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) { this.setStatus("NPC 保存失败：ID 不能为空且不能重复。", true); return; }
      doc.npcs = rows.map((row) => ({ id: row.querySelector("[data-npc-id]").value.trim(), name: row.querySelector("[data-npc-name]").value, avatar: row.querySelector("[data-npc-avatar]").value || "🙂", initialFavorability: Math.max(0, Math.min(100, Number(row.querySelector("[data-npc-favor]").value) || 0)), initialSan: Math.max(0, Math.min(100, Number(row.querySelector("[data-npc-san]").value) || 0)) }));
      this.docs.set("npcs.json", doc); if (action === "download-npcs") downloadJson("npcs.json", doc); this.setStatus(`npcs.json 已${action === "download-npcs" ? "下载" : "保存到内存"}。`); return;
    }
    if (action === "add-qa-entry") { const qa = await this.loadDoc("chatgtp_qa.json"); const keywords = await this.loadDoc("keywords.json"); const firstId = keywords.keywords?.[0]?.id || ""; qa.entries = qa.entries || []; qa.entries.push({ keywords: firstId ? [firstId] : [], answer: "", corruptedAnswer: "", corruptedSameAsNormal: true }); this.docs.set("chatgtp_qa.json", qa); return this.showChatgtp(); }
    if (action === "save-qa" || action === "download-qa") {
      const qa = await this.loadDoc("chatgtp_qa.json");
      const rows = Array.from(this.root.querySelectorAll("[data-qa-entry]"));
      const entries = rows.map((row) => {
        const keywords = Array.from(row.querySelectorAll("[data-qa-keyword]"), (select) => select.value).filter(Boolean);
        const corruptedSameAsNormal = row.querySelector("[data-qa-same]").checked;
        const entry = { keywords: [...new Set(keywords)], answer: row.querySelector("[data-qa-answer]").value, corruptedSameAsNormal };
        if (!corruptedSameAsNormal) entry.corruptedAnswer = row.querySelector("[data-qa-corrupted]").value;
        return entry;
      });
      const keys = entries.map((entry) => [...entry.keywords].sort().join("+"));
      if (entries.some((entry) => entry.keywords.length === 0 || entry.keywords.length > 2 || !entry.answer.trim()) || new Set(keys).size !== keys.length) { this.setStatus("ChatGTP 保存失败：每条问答需要 1～2 个关键词、正常回答，且关键词组合不能重复。", true); return; }
      qa.entries = entries; this.docs.set("chatgtp_qa.json", qa); if (action === "download-qa") downloadJson("chatgtp_qa.json", qa); this.setStatus(`chatgtp_qa.json 已${action === "download-qa" ? "下载" : "保存到内存"}。`); return;
    }
    if (action === "add-keyword") { const doc = await this.loadDoc("keywords.json"); doc.keywords.push({ id: `new_keyword_${doc.keywords.length + 1}`, content: "新关键词" }); this.docs.set("keywords.json", doc); return this.showKeywords(); }
    if (action === "remove-keyword" || action.startsWith("remove-keyword-")) { const index = Number(action.split("-").pop()); const doc = await this.loadDoc("keywords.json"); doc.keywords.splice(index, 1); this.docs.set("keywords.json", doc); return this.showKeywords(); }

    if (action === "save-keywords" || action === "download-keywords") {
      const doc = await this.loadDoc("keywords.json");
      const rows = Array.from(this.root.querySelectorAll("[data-keyword-row]"));
      const ids = rows.map((row) => row.querySelector("[data-k-id]").value.trim());
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) { this.setStatus("关键词保存失败：ID 不能为空且不能重复。", true); return; }
      doc.keywords = rows.map((row) => {
        return { id: row.querySelector("[data-k-id]").value.trim(), content: row.querySelector("[data-k-content]").value };
      });
      this.docs.set("keywords.json", doc); if (action === "download-keywords") downloadJson("keywords.json", doc); this.setStatus(`keywords.json 已${action === "download-keywords" ? "下载" : "保存到内存"}。`); return;
    }
  }

  replaceActorTree(tree) { this.actorTreeDraft = tree; this.root.querySelector("[data-dev-panel]").innerHTML = ""; this.showActorEditor().catch((err) => this.setStatus(`刷新分支树失败：${err.message}`, true)); }
}
// DEV-TOOLS:END
