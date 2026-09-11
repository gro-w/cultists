// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";

const TYPES = ["bool", "integer", "real", "string", "json"];

export class LocalVariableEditorView {
  constructor({ localVariableManager } = {}) {
    this.manager = localVariableManager;
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `<div class="ng-list-manager-lists"><div class="ng-list-manager-toolbar"><button data-action="new">新建变量</button><button data-action="delete">删除变量</button></div><div class="ng-list-manager-list-items"></div></div><div class="ng-list-manager-activities"><div class="ng-list-manager-toolbar"><button data-action="save">写入磁盘</button><span class="ng-editor-status"></span></div><div class="ng-window-editor-structure ng-local-variable-fields"></div></div>`;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-local-variable-fields");
    this.statusEl = el.querySelector(".ng-editor-status");
    el.querySelector('[data-action="new"]').addEventListener("click", () => {
      const id = prompt("本地变量 id（稳定标识）：");
      if (id === null) return;
      try { this.manager.register({ id, name: id, type: "string" }); this.selectedId = String(id); this.render(); }
      catch (error) { this.statusEl.textContent = `新建失败: ${error.message}`; }
    });
    el.querySelector('[data-action="delete"]').addEventListener("click", () => { if (this.selectedId !== null) { this.manager.unregister(this.selectedId); this.selectedId = null; this.render(); } });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try { await writeDataFile("local-variables.framework.json", JSON.stringify(this.manager.toJSON(), null, 2)); this.statusEl.textContent = "已写入磁盘"; }
      catch (error) { this.statusEl.textContent = `写入失败: ${error.message}`; }
    });
  }

  render() {
    this.listEl.innerHTML = "";
    this.manager.list().forEach((definition) => {
      const row = document.createElement("div");
      row.className = `ng-list-manager-list-item${definition.id === this.selectedId ? " selected" : ""}`;
      row.textContent = `${definition.id}: ${definition.name}`;
      row.addEventListener("click", () => { this.selectedId = definition.id; this.render(); });
      this.listEl.appendChild(row);
    });
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const definition = this.manager.definition(this.selectedId);
    if (!definition) { this.fieldsEl.textContent = "选择一个本地变量以编辑"; return; }
    const row = document.createElement("div");
    row.className = "ng-window-editor-structure-row";
    const input = (value, onChange, placeholder = "") => { const element = document.createElement("input"); element.value = value ?? ""; element.placeholder = placeholder; element.addEventListener("change", () => onChange(element.value)); return element; };
    const name = input(definition.name, (value) => { definition.name = value; });
    const type = document.createElement("select");
    TYPES.forEach((item) => { const option = new Option(item, item); option.selected = item === definition.type; type.add(option); });
    type.addEventListener("change", () => { definition.type = type.value; });
    const defaultValue = input(typeof definition.defaultValue === "object" ? JSON.stringify(definition.defaultValue) : definition.defaultValue, (value) => { try { definition.defaultValue = definition.type === "json" ? JSON.parse(value) : value; } catch { this.statusEl.textContent = "默认值 JSON 无效"; } });
    row.append(name, type, defaultValue, input(definition.description, (value) => { definition.description = value; }, "description"));
    this.fieldsEl.appendChild(row);
  }
}

export default LocalVariableEditorView;
// DEV-TOOLS:END