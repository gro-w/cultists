// DEV-TOOLS:START
/**
 * WindowDefinitionManagerView - lists loaded window definitions and opens
 * each one in a WindowEditorView (plan §7). Operates directly on the live
 * `WindowDefinitionStore` (plan follow-up: "自定义窗口管理器也可以+-按钮
 * (新建、删除、复制)") so new/duplicate/delete actions are immediately
 * visible without a separate draft/refresh step, mirroring how
 * DesktopIconEditorView/DataStructureEditorView already edit their live
 * manager instances directly.
 */
function defaultWindowDefinition(id) {
  return {
    id,
    title: id,
    mode: "window",
    fullscreen: false,
    geometry: { x: 80, y: 60, width: 480, height: 320 },
    root: { widgetId: "root", type: "container", flow: "stack", gap: 8, padding: 10, children: [] },
    events: { onCreate: null, onDestroy: null },
  };
}

export class WindowDefinitionManagerView {
  constructor(windowDefinitionStore, { openEditor } = {}) {
    this.windowDefinitionStore = windowDefinitionStore;
    this.openEditor = openEditor || (() => {});
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists" style="width:100%;">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new">新建窗口</button>
          <button type="button" data-action="duplicate">复制窗口</button>
          <button type="button" data-action="delete">删除窗口</button>
          <span class="ng-editor-status">双击一个窗口定义以在 WYSIWYG 编辑器中打开</span>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
    `;
    this.el = el;
    this.itemsEl = el.querySelector(".ng-list-manager-list-items");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new"]').addEventListener("click", () => {
      const id = prompt("新窗口 ID:");
      if (!id) return;
      if (this.windowDefinitionStore.get(id)) { this.statusEl.textContent = `窗口 "${id}" 已存在`; return; }
      this.windowDefinitionStore.register(defaultWindowDefinition(id));
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="duplicate"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      const source = this.windowDefinitionStore.get(this.selectedId);
      if (!source) return;
      const id = prompt("新窗口 ID:", `${this.selectedId}-copy`);
      if (!id) return;
      if (this.windowDefinitionStore.get(id)) { this.statusEl.textContent = `窗口 "${id}" 已存在`; return; }
      this.windowDefinitionStore.register({ ...JSON.parse(JSON.stringify(source)), id });
      this.selectedId = id;
      this.render();
    });
    el.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!this.selectedId) return;
      this.windowDefinitionStore.unregister(this.selectedId);
      this.selectedId = null;
      this.render();
    });
  }

  render() {
    this.itemsEl.innerHTML = "";
    // Only definitions with a `root` widget tree are WYSIWYG-editable (plan
    // §7.1); legacy `body`-only definitions (e.g. example.json, or dev-tool
    // windows registered by DeveloperMode itself) have no editable
    // structure and would otherwise crash the editor on open.
    for (const definition of this.windowDefinitionStore.list().filter((definition) => definition.root)) {
      const item = document.createElement("div");
      item.className = "ng-list-manager-list-item" + (definition.id === this.selectedId ? " selected" : "");
      item.textContent = `${definition.id}${definition.fullscreen ? " (全屏)" : ""}`;
      item.addEventListener("click", () => { this.selectedId = definition.id; this.render(); });
      item.addEventListener("dblclick", () => this.openEditor(definition));
      this.itemsEl.appendChild(item);
    }
  }
}

export default WindowDefinitionManagerView;
// DEV-TOOLS:END
