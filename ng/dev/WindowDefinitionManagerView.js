// DEV-TOOLS:START
/**
 * WindowDefinitionManagerView - lists loaded window definitions and opens
 * each one in a WindowEditorView (plan §7). Kept intentionally minimal: it
 * has no model of its own beyond the list of definitions handed to it by
 * DeveloperMode, since selection/mutation state belongs to each opened
 * editor window instead (mirrors the Activity 列表管理器/编辑器 split).
 */
export class WindowDefinitionManagerView {
  constructor(definitions, { openEditor } = {}) {
    this.definitions = definitions;
    this.openEditor = openEditor || (() => {});
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists" style="width:100%;">
        <div class="ng-list-manager-toolbar">
          <span class="ng-editor-status">双击一个窗口定义以在 WYSIWYG 编辑器中打开</span>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
    `;
    this.el = el;
    this.itemsEl = el.querySelector(".ng-list-manager-list-items");
  }

  render() {
    this.itemsEl.innerHTML = "";
    // Only definitions with a `root` widget tree are WYSIWYG-editable (plan
    // §7.1); legacy `body`-only definitions (e.g. example.json, or dev-tool
    // windows registered by DeveloperMode itself) have no editable
    // structure and would otherwise crash the editor on open.
    for (const definition of this.definitions.filter((definition) => definition.root)) {
      const item = document.createElement("div");
      item.className = "ng-list-manager-list-item";
      item.textContent = `${definition.id}${definition.fullscreen ? " (全屏)" : ""}`;
      item.addEventListener("dblclick", () => this.openEditor(definition));
      this.itemsEl.appendChild(item);
    }
  }
}

export default WindowDefinitionManagerView;
// DEV-TOOLS:END
