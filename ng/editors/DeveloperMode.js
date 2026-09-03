// DEV-TOOLS:START
import { ActivityEditor } from "./ActivityEditor.js";
import { ActivityListManager } from "./ActivityListManager.js";
import { CustomWindowEditor } from "./CustomWindowEditor.js";
import { WindowRuntime } from "../core/WindowRuntime.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (label, glyph, action) => `<button class="ng-dev-icon" data-dev-action="${action}"><b>${glyph}</b><span>${label}</span></button>`;

/** NG developer shell: legacy-style Database App + Runtime Debugger. */
export class DeveloperMode {
  constructor({ definitions, validator, variables, structures, windowManager, store, state, queues, nodes, activityLists } = {}) { Object.assign(this, { definitions, validator, variables, structures, windowManager, store, state, queues, nodes, activityLists }); this.root = null; }
  mount(root) { this.root = root; this.render(); }
  render() {
    this.root.innerHTML = `<div class="ng-dev-shell"><header class="ng-dev-header"><strong>开发人员模式</strong><span>双击图标打开独立工具窗口</span></header><section class="ng-dev-section ng-dev-database"><h2>编辑器</h2><p>编辑所有自定义 JSON：活动蓝图、窗口定义、变量、结构和数据库</p><div class="ng-dev-grid">${icon("活动蓝图", "🧩", "blueprint")}${icon("WYSIWYG 窗口", "🪟", "window")}${icon("变量定义", "🔢", "variables")}${icon("结构定义", "🧱", "structures")}${icon("数据库 JSON", "🗃️", "databases")}</div></section><section class="ng-dev-section ng-dev-debugger"><h2>调试器</h2><p>查看新引擎当前运行时内容，不修改静态定义</p><div class="ng-dev-grid">${icon("引擎状态", "🕒", "state")}${icon("活动队列", "📋", "queues")}${icon("窗口实例", "🖥️", "windows")}</div></section><footer data-dev-status>开发人员模式就绪。</footer></div>`;
    this.root.querySelectorAll("[data-dev-action]").forEach((el) => el.addEventListener("dblclick", () => this.open(el.dataset.devAction)));
  }
  status(text) { const el = this.root.querySelector("[data-dev-status]"); if (el) el.textContent = text; }
  open(action) {
    const host = document.createElement("div"); const titles = { blueprint: "蓝图编辑器", window: "WYSIWYG 窗口管理器", variables: "公共变量 JSON 编辑器", structures: "数据结构 JSON 编辑器", databases: "数据库 JSON 编辑器", state: "运行时调试器 · 引擎状态", queues: "运行时调试器 · 活动队列", windows: "运行时调试器 · 窗口实例" };
    const wideEditor = action === "blueprint" || action === "window";
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1000;
    const editorWidth = Math.max(640, Math.min(760, viewportWidth - 20));
    const frame = this.windowManager.openDynamic({ id: `ng-dev-${action}`, title: titles[action], content: host, width: wideEditor ? editorWidth : 680, height: 680 });
    if (wideEditor && frame.el.offsetWidth > editorWidth) { const geometry = this.windowManager.geometryFromElement(frame.el); frame.setGeometry({ ...geometry, width: editorWidth }); frame.persistGeometry(); }
    if (!frame.element && frame.el) { frame.el.querySelector(".ng-title").textContent = titles[action]; frame.el.querySelector(".ng-body").replaceChildren(host); }
    this.status(`已打开：${titles[action]}`);
    if (action === "blueprint") this.openBlueprint(host);
    else if (action === "window") this.openWindow(host);
    else this.openJsonOrRuntime(host, action);
  }
  openBlueprint(host) {
    if (!this.definitions.list().length) return host.textContent = "没有已加载的 Activity。";
    const manager = new ActivityListManager({ definitions: this.definitions, activityLists: this.activityLists, onOpen: (definition) => this.openActivityEditor(definition), onSave: (list) => this.saveActivityList(list) });
    manager.mount(host);
  }
  openActivityEditor(definition) {
    const host = document.createElement("div");
    const frame = this.windowManager.openDynamic({ id: `ng-activity-${definition.id}`, title: `蓝图：${definition.displayName || definition.id}`, content: host, width: 760, height: 680 });
    const editor = new ActivityEditor({ definition, nodes: this.nodes, validator: (value) => this.validator.validate(value), writeToDisk: (file, value) => this.writeToDisk(file, value), fileScope: { fileName: `activities/${definition.id}.json`, type: "activity" }, fileLabel: definition.displayName || definition.id, onChange: (value) => { this.definitions.replace(value); this.status(`Activity ${value.id} 已更新到内存。`); } });
    host.innerHTML = editor.html(); editor.mount(host.querySelector(".dev-de-root") || host); return frame;
  }
  async saveActivityList(list) {
    const file = `activity-lists/${list.id}.json`;
    try { await this.writeToDisk(file, list); this.status(`已保存 ${file}`); } catch (error) { this.status(`保存失败：${error.message}`); }
  }
  async writeToDisk(file, value) {
    const response = await fetch(`/api/file?f=${encodeURIComponent(file)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    if (!response.ok) throw new Error(await response.text());
    const read = await fetch(`/data/${file}?t=${Date.now()}`);
    if (!read.ok) throw new Error(`写入后无法读取 ${file}`);
    const saved = await read.json();
    if (JSON.stringify(saved) !== JSON.stringify(value)) throw new Error("保存后的文件内容校验失败");
  }
  openWindow(host) {
    const definitions = [...this.windowManager.definitions.values()];
    if (!definitions.length) return host.textContent = "没有已加载的窗口定义。";
    host.innerHTML = `<div class="ng-dev-picker"><label>窗口定义 <select data-window-definition></select></label><div data-window-editor></div></div>`;
    const select = host.querySelector("[data-window-definition]"); select.innerHTML = definitions.map((definition) => `<option value="${esc(definition.id)}">${esc(definition.title || definition.id)}</option>`).join("");
    const mount = () => { const definition = definitions.find((item) => item.id === select.value); new CustomWindowEditor({ definition, runtime: new WindowRuntime(), onChange: (value) => this.windowManager.register(value) }).mount(host.querySelector("[data-window-editor]")); };
    select.onchange = mount; mount();
  }
  async openJsonOrRuntime(host, action) {
    if (["state", "queues", "windows"].includes(action)) {
      const read = () => action === "state" ? this.state : action === "queues" ? [...this.queues.queues?.values?.() || []].map((q) => ({ id: q.queueId, count: q.items?.length || q.getPending?.().length || 0 })) : [...this.windowManager.instances.values()].map((frame) => ({ id: frame.windowInstanceId, window: frame.definition.id, geometry: this.windowManager.geometryFromElement(frame.el) }));
      const render = () => { host.innerHTML = `<div class="ng-runtime-debug"><h2>${esc(action)}</h2><pre>${esc(JSON.stringify(read(), null, 2))}</pre></div>`; }; render(); return;
    }
    const files = { variables: "variables.json", structures: "structures.json", databases: "databases.json" }; const value = await this.store.loadJSON(files[action]); host.innerHTML = `<div class="ng-json-editor"><h2>${files[action]}</h2><textarea data-json>${esc(JSON.stringify(value, null, 2))}</textarea><button data-save>保存内存</button><pre data-json-status>未修改</pre></div>`; host.querySelector("[data-save]").onclick = () => { try { JSON.parse(host.querySelector("[data-json]").value); host.querySelector("[data-json-status]").textContent = "JSON 校验通过，已保留在当前编辑器草稿。"; } catch (error) { host.querySelector("[data-json-status]").textContent = `JSON 错误：${error.message}`; } };
  }
}
// DEV-TOOLS:END
