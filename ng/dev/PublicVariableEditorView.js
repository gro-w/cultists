// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";

const VARIABLE_TYPES = ["bool", "smallInteger", "integer", "real", "string", "object"];

/**
 * PublicVariableEditorView - visual editor for `data/public-variables.json`
 * (plan §10.2 "公共变量 schema"). Lets a developer create/edit/remove
 * public-variable definitions (id/name/type/min/max/persistent/readOnly/
 * objectTarget/description) without hand editing JSON, mirroring
 * DataStructureEditorView's list+detail layout, then persists via the
 * shared `writeDataFile` and registers the change into the live
 * `PublicVariableManager` immediately so a public-variable debugger opened
 * afterwards reflects the new schema right away.
 */
export class PublicVariableEditorView {
  constructor({ publicVariableManager } = {}) {
    this.publicVariableManager = publicVariableManager;
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
          <button type="button" data-action="new-variable">新建变量</button>
          <button type="button" data-action="delete-variable">删除变量</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="save">写入磁盘</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-window-editor-structure ng-public-variable-fields"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-public-variable-fields");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new-variable"]').addEventListener("click", () => {
      const idText = prompt("新变量 id (0..65535):");
      if (idText === null) return;
      const id = Number(idText);
      try {
        this.publicVariableManager.register({ id, name: `variable-${id}`, type: "bool" });
        this.selectedId = id;
        this.render();
      } catch (err) {
        this.statusEl.textContent = `新建失败: ${err.message}`;
      }
    });
    el.querySelector('[data-action="delete-variable"]').addEventListener("click", () => {
      if (this.selectedId === null) return;
      this.publicVariableManager.unregister(this.selectedId);
      this.selectedId = null;
      this.render();
    });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("public-variables.json", JSON.stringify(this.publicVariableManager.toJSON(), null, 2));
        this.statusEl.textContent = "已写入磁盘";
      } catch (err) {
        this.statusEl.textContent = `写入失败: ${err.message}`;
      }
    });
  }

  render() {
    this.listEl.innerHTML = "";
    for (const definition of this.publicVariableManager.list()) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (definition.id === this.selectedId ? " selected" : "");
      row.textContent = `${definition.id}: ${definition.name}`;
      row.addEventListener("click", () => { this.selectedId = definition.id; this.render(); });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const definition = this.publicVariableManager.definition(this.selectedId);
    if (!definition) {
      this.fieldsEl.textContent = "选择一个公共变量以编辑";
      return;
    }
    const row = document.createElement("div");
    row.className = "ng-window-editor-structure-row";

    const nameInput = document.createElement("input");
    nameInput.value = definition.name;
    nameInput.title = "名称";
    nameInput.addEventListener("change", () => { definition.name = nameInput.value; });

    const typeSelect = document.createElement("select");
    for (const type of VARIABLE_TYPES) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = definition.type === type;
      typeSelect.appendChild(option);
    }
    typeSelect.addEventListener("change", () => { definition.type = typeSelect.value; });

    const persistentLabel = document.createElement("label");
    const persistentCheckbox = document.createElement("input");
    persistentCheckbox.type = "checkbox";
    persistentCheckbox.checked = definition.persistent !== false;
    persistentCheckbox.addEventListener("change", () => { definition.persistent = persistentCheckbox.checked; });
    persistentLabel.append(persistentCheckbox, " 持久化");

    const readOnlyLabel = document.createElement("label");
    const readOnlyCheckbox = document.createElement("input");
    readOnlyCheckbox.type = "checkbox";
    readOnlyCheckbox.checked = Boolean(definition.readOnly);
    readOnlyCheckbox.addEventListener("change", () => { definition.readOnly = readOnlyCheckbox.checked; });
    readOnlyLabel.append(readOnlyCheckbox, " 只读");

    const minInput = document.createElement("input");
    minInput.placeholder = "min";
    minInput.value = definition.min ?? "";
    minInput.addEventListener("change", () => {
      definition.min = minInput.value === "" ? undefined : Number(minInput.value);
    });

    const maxInput = document.createElement("input");
    maxInput.placeholder = "max";
    maxInput.value = definition.max ?? "";
    maxInput.addEventListener("change", () => {
      definition.max = maxInput.value === "" ? undefined : Number(maxInput.value);
    });

    const objectTargetInput = document.createElement("input");
    objectTargetInput.placeholder = "objectTarget (e.g. database:inventoryItems)";
    objectTargetInput.value = definition.objectTarget || "";
    objectTargetInput.addEventListener("change", () => { definition.objectTarget = objectTargetInput.value || null; });

    const descriptionInput = document.createElement("input");
    descriptionInput.placeholder = "description";
    descriptionInput.value = definition.description || "";
    descriptionInput.addEventListener("change", () => { definition.description = descriptionInput.value; });

    row.append(
      nameInput,
      typeSelect,
      persistentLabel,
      readOnlyLabel,
      minInput,
      maxInput,
      objectTargetInput,
      descriptionInput,
    );
    this.fieldsEl.appendChild(row);
  }
}

export default PublicVariableEditorView;
// DEV-TOOLS:END
