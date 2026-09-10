// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";
import { ActivityEditorView } from "./ActivityEditorView.js";
/**
 * DatabaseEditorView - persistent editor for canonical JSON-backed records. It
 * §9.3 "不能在 UI 中直接改数据库绕过 API"). Lists every registered
 * database, browses its records as a table, and supports creating,
 * editing and deleting records - but exclusively through
 * `DataStore.createRecord/updateRecord/deleteRecord`, never by reaching
 * into its internal Map, so validation and clone-on-write semantics are
 * never bypassed even from developer tools.
 */
export class DatabaseEditorView {
  constructor({ dataStore, dataStructureManager, dataLoader } = {}) {
    this.dataStore = dataStore;
    this.dataStructureManager = dataStructureManager;
    this.dataLoader = dataLoader;
    this.selectedDatabaseId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="save-database">保存数据库 JSON</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-record">新建记录</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-database-debugger-records"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.recordsEl = el.querySelector(".ng-database-debugger-records");
    this.statusEl = el.querySelector(".ng-editor-status");
    el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
    el.querySelector('[data-action="save-database"]').addEventListener("click", () => this._saveDatabase());
    el.querySelector('[data-action="new-record"]').addEventListener("click", () => {
      if (!this.selectedDatabaseId) return;
      try {
        this.dataStore.createRecord(this.selectedDatabaseId, {});
        this.render();
      } catch (err) {
        this.statusEl.textContent = `创建失败: ${err.message}`;
      }
    });
  }

  async _saveDatabase() {
    if (!this.selectedDatabaseId) return;
    try {
      const db = this.dataStore.listDatabases().find((entry) => entry.databaseId === this.selectedDatabaseId);
      const fileName = db?.recordFile || "seed-records.json";
      const source = await this.dataLoader.loadJSON(fileName, { cache: false });
      const merged = { ...(source || {}) };
      merged[this.selectedDatabaseId] = this.dataStore.findRecords(this.selectedDatabaseId, {});
      await writeDataFile(fileName, JSON.stringify(merged, null, 2));
      await writeDataFile("databases.framework.json", JSON.stringify(this.dataStore.listDatabases().map(({ recordCount, ...definition }) => definition), null, 2));
      this.statusEl.textContent = `已写入 ${fileName} 和 databases.framework.json`;
    } catch (error) {
      this.statusEl.textContent = `写入失败: ${error.message}`;
    }
  }

  render() {
    this.listEl.innerHTML = "";
    const databases = this.dataStore.listDatabases();
    if (!this.selectedDatabaseId && databases.length) this.selectedDatabaseId = databases[0].databaseId;
    for (const db of databases) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (db.databaseId === this.selectedDatabaseId ? " selected" : "");
      row.textContent = `${db.databaseId} (${db.recordCount})`;
      row.addEventListener("click", () => { this.selectedDatabaseId = db.databaseId; this.render(); });
      this.listEl.appendChild(row);
    }
    this._renderRecords();
  }

  _renderRecords() {
    this.recordsEl.innerHTML = "";
    if (!this.selectedDatabaseId) {
      this.recordsEl.textContent = "没有已注册的数据库";
      return;
    }
    const records = this.dataStore.findRecords(this.selectedDatabaseId, {});
    const db = this.dataStore.listDatabases().find((entry) => entry.databaseId === this.selectedDatabaseId);
    const structure = this.dataStructureManager?.get(db?.recordType);
    for (const record of records) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";

      const fields = document.createElement("div");
      fields.className = "ng-database-record-fields";
      const controls = new Map();
      for (const field of structure?.fields || Object.keys(record).map((id) => ({ id, type: "string" }))) {
        const label = document.createElement("label");
        label.className = "ng-window-editor-field";
        const caption = document.createElement("span");
        caption.textContent = `${field.id} (${field.type})`;
        let control;
        const value = record[field.id];
        if (field.type === "activity") {
          const activityMap = value && typeof value === "object" ? structuredClone(value) : {};
          const activityIds = Object.keys(activityMap);
          const activitySelect = document.createElement("select");
          const activityEditorHost = document.createElement("div");
          activityEditorHost.className = "ng-embedded-activity-editor";
          const addActivityButton = document.createElement("button");
          addActivityButton.type = "button";
          addActivityButton.textContent = "新增内嵌 Activity";
          const mountActivity = (activityId) => {
            activityEditorHost.replaceChildren();
            if (!activityId) return;
            const editor = new ActivityEditorView({
              activityId: `${this.selectedDatabaseId}:${this._primaryKeyOf(record)}:${field.id}:${activityId}`,
              blueprint: activityMap[activityId] || {},
              displayName: activityId,
              onSaveToMemory: (blueprint) => {
                activityMap[activityId] = blueprint;
                this.dataStore.updateRecord(this.selectedDatabaseId, this._primaryKeyOf(record), { [field.id]: activityMap });
                this.statusEl.textContent = `内嵌 Activity「${activityId}」已保存`;
              },
            });
            activityEditorHost.appendChild(editor.el);
          };
          for (const activityId of activityIds) {
            const option = document.createElement("option");
            option.value = activityId;
            option.textContent = activityId;
            activitySelect.appendChild(option);
          }
          activitySelect.addEventListener("change", () => mountActivity(activitySelect.value));
          addActivityButton.addEventListener("click", () => {
            const activityId = prompt("内嵌 Activity id:");
            if (!activityId || activityMap[activityId]) return;
            activityMap[activityId] = {};
            const option = document.createElement("option");
            option.value = activityId;
            option.textContent = activityId;
            activitySelect.appendChild(option);
            activitySelect.value = activityId;
            mountActivity(activityId);
          });
          const activityEditor = document.createElement("div");
          activityEditor.append(activitySelect, addActivityButton, activityEditorHost);
          label.append(caption, activityEditor);
          fields.appendChild(label);
          mountActivity(activitySelect.value);
          continue;
        } else if (field.type === "bool") {
          control = document.createElement("input");
          control.type = "checkbox";
          control.checked = Boolean(value);
        } else if (["integer", "smallInteger", "real"].includes(field.type)) {
          control = document.createElement("input");
          control.type = "number";
          control.step = field.type === "real" ? "any" : "1";
          control.value = value ?? "";
        } else if (field.type === "array" || field.type.startsWith("array<") || field.type === "object") {
          control = document.createElement("textarea");
          control.rows = 2;
          control.value = JSON.stringify(value ?? (field.type === "object" ? {} : []), null, 2);
        } else {
          control = document.createElement("input");
          control.type = "text";
          control.value = value ?? "";
        }
        control.dataset.fieldId = field.id;
        controls.set(field.id, { control, field });
        label.append(caption, control);
        fields.appendChild(label);
      }

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "保存修改";
      saveButton.addEventListener("click", () => {
        try {
          const patch = {};
          for (const [fieldId, { control, field }] of controls) {
            if (field.type === "bool") patch[fieldId] = control.checked;
            else if (["integer", "smallInteger"].includes(field.type)) patch[fieldId] = Number(control.value);
            else if (field.type === "real") patch[fieldId] = Number(control.value);
            else if (field.type === "activity") continue;
            else if (field.type === "array" || field.type.startsWith("array<") || field.type === "object") patch[fieldId] = JSON.parse(control.value || (field.type === "object" ? "{}" : "[]"));
            else patch[fieldId] = control.value;
          }
          this.dataStore.updateRecord(this.selectedDatabaseId, this._primaryKeyOf(record), patch);
          this.statusEl.textContent = "已更新";
          this.render();
        } catch (err) {
          this.statusEl.textContent = `更新失败: ${err.message}`;
        }
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", () => {
        try {
          this.dataStore.deleteRecord(this.selectedDatabaseId, this._primaryKeyOf(record));
          this.render();
        } catch (err) {
          this.statusEl.textContent = `删除失败: ${err.message}`;
        }
      });

      row.append(fields, saveButton, deleteButton);
      this.recordsEl.appendChild(row);
    }
  }

  _primaryKeyOf(record) {
    const db = this.dataStore.listDatabases().find((entry) => entry.databaseId === this.selectedDatabaseId);
    return record[db?.primaryKey || "id"];
  }
}

export default DatabaseEditorView;
// DEV-TOOLS:END
