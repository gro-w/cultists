// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";

const FIELD_TYPES = ["bool", "smallInteger", "integer", "real", "string", "objectRef", "array", "array<string>", "array<number>"];

/**
 * DataStructureEditorView - visual editor for `data/structures.json` (plan
 * §9.2 "结构 schema"). Lets a developer create/rename/remove structures and
 * add/edit/remove their fields (id/type/required/default) without hand
 * editing JSON, then persists via the shared `writeDataFile` + registers
 * the change into the live `DataStructureManager` immediately so any open
 * database debugger reflects the new schema right away.
 */
export class DataStructureEditorView {
  constructor({ dataStructureManager } = {}) {
    this.dataStructureManager = dataStructureManager;
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-structure">新建结构</button>
          <button type="button" data-action="delete-structure">删除结构</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-field">新增字段</button>
          <button type="button" data-action="save">写入磁盘</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-window-editor-structure ng-data-structure-fields"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-data-structure-fields");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new-structure"]').addEventListener("click", () => {
      const id = prompt("新结构 id:");
      if (!id) return;
      this.dataStructureManager.register({ id, displayName: id, fields: [] });
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="delete-structure"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      this.dataStructureManager.unregister(this.selectedId);
      this.selectedId = null;
      this.render();
    });
    el.querySelector('[data-action="new-field"]').addEventListener("click", () => {
      const structure = this.dataStructureManager.get(this.selectedId);
      if (!structure) return;
      const fieldId = prompt("新字段 id:");
      if (!fieldId) return;
      structure.fields.push({ id: fieldId, type: "string", required: false });
      this.render();
    });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("structures.json", JSON.stringify(this.dataStructureManager.toJSON(), null, 2));
        this.statusEl.textContent = "已写入磁盘";
      } catch (err) {
        this.statusEl.textContent = `写入失败: ${err.message}`;
      }
    });
  }

  render() {
    this.listEl.innerHTML = "";
    for (const structure of this.dataStructureManager.list()) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (structure.id === this.selectedId ? " selected" : "");
      row.textContent = structure.id;
      row.addEventListener("click", () => { this.selectedId = structure.id; this.render(); });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const structure = this.dataStructureManager.get(this.selectedId);
    if (!structure) {
      this.fieldsEl.textContent = "选择一个结构以编辑字段";
      return;
    }
    for (const field of structure.fields) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";

      const idInput = document.createElement("input");
      idInput.value = field.id;
      idInput.title = "字段 id";
      idInput.addEventListener("change", () => { field.id = idInput.value; this.render(); });

      const typeSelect = document.createElement("select");
      for (const type of FIELD_TYPES) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        option.selected = field.type === type;
        typeSelect.appendChild(option);
      }
      typeSelect.addEventListener("change", () => { field.type = typeSelect.value; });

      const requiredLabel = document.createElement("label");
      const requiredCheckbox = document.createElement("input");
      requiredCheckbox.type = "checkbox";
      requiredCheckbox.checked = Boolean(field.required);
      requiredCheckbox.addEventListener("change", () => { field.required = requiredCheckbox.checked; });
      requiredLabel.append(requiredCheckbox, " 必填");

      const defaultInput = document.createElement("input");
      defaultInput.placeholder = "default (JSON)";
      defaultInput.value = field.default !== undefined ? JSON.stringify(field.default) : "";
      defaultInput.addEventListener("change", () => {
        if (!defaultInput.value) { delete field.default; return; }
        try {
          field.default = JSON.parse(defaultInput.value);
        } catch (err) {
          this.statusEl.textContent = `default 不是合法 JSON: ${err.message}`;
        }
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "删除";
      removeButton.addEventListener("click", () => {
        structure.fields = structure.fields.filter((f) => f !== field);
        this.render();
      });

      row.append(idInput, typeSelect, requiredLabel, defaultInput, removeButton);
      this.fieldsEl.appendChild(row);
    }
  }
}

export default DataStructureEditorView;
// DEV-TOOLS:END
