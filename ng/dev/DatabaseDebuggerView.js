// DEV-TOOLS:START
/**
 * DatabaseDebuggerView - runtime debugger for the live `DataStore` (plan
 * §9.3 "不能在 UI 中直接改数据库绕过 API"). Lists every registered
 * database, browses its records as a table, and supports creating,
 * editing and deleting records - but exclusively through
 * `DataStore.createRecord/updateRecord/deleteRecord`, never by reaching
 * into its internal Map, so validation and clone-on-write semantics are
 * never bypassed even from developer tools.
 */
export class DatabaseDebuggerView {
  constructor({ dataStore } = {}) {
    this.dataStore = dataStore;
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
    for (const record of records) {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";

      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(record, null, 2);
      textarea.rows = 3;

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "保存修改";
      saveButton.addEventListener("click", () => {
        try {
          const patch = JSON.parse(textarea.value);
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

      row.append(textarea, saveButton, deleteButton);
      this.recordsEl.appendChild(row);
    }
  }

  _primaryKeyOf(record) {
    const db = this.dataStore.listDatabases().find((entry) => entry.databaseId === this.selectedDatabaseId);
    return record[db?.primaryKey || "id"];
  }
}

export default DatabaseDebuggerView;
// DEV-TOOLS:END
