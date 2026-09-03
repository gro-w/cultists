// DEV-TOOLS:START
import { createWindowEditorModel } from "./WindowEditorModel.js";
import { renderWindowRoot } from "../core/WidgetLayoutRenderer.js";
import { writeDataFile, downloadTextFile } from "./devApi.js";

const WIDGET_TYPES = [
  "container", "label", "button", "textInput", "textarea",
  "select", "checkbox", "image", "list", "table", "progress", "spacer",
];

/**
 * WindowEditorView - WYSIWYG editor for a window definition (plan §7.3).
 * The center canvas is rendered with the exact same
 * `renderWindowRoot()` used by the runtime WindowFrame, so the editor
 * preview and the running window can never visually diverge (plan §7.1).
 * A separate structure tree gives selection/reorder/reparent affordances
 * that a pure visual canvas can't express for flex/grid containers, whose
 * x/y are explicitly not meaningful (plan §7.3 "对 flex/grid 容器明确显示
 * 哪些 x/y 属性不生效").
 */
export class WindowEditorView {
  constructor({ definition, dataFileName, onSaveToMemory } = {}) {
    this.model = createWindowEditorModel({ definition });
    this.dataFileName = dataFileName || null;
    this.onSaveToMemory = onSaveToMemory || (() => {});
    this._buildDom();
    this.render();
    this._bindKeys();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-window-editor";
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="ng-editor-toolbar">
        <button type="button" data-action="undo" title="撤销">撤销</button>
        <button type="button" data-action="redo" title="重做">重做</button>
        <select class="ng-window-editor-add-type"></select>
        <button type="button" data-action="add" title="向选中容器添加组件">添加</button>
        <button type="button" data-action="duplicate" title="复制选中">复制</button>
        <button type="button" data-action="delete" title="删除选中 (Delete)">删除选中</button>
        <button type="button" data-action="save" title="保存到内存">保存到内存</button>
        <button type="button" data-action="download" title="下载 JSON">下载</button>
        <button type="button" data-action="write-disk" title="写入磁盘">写入磁盘</button>
        <span class="ng-editor-status"></span>
      </div>
      <div class="ng-window-editor-body">
        <div class="ng-window-editor-structure"></div>
        <div class="ng-window-editor-preview"></div>
        <div class="ng-window-editor-inspector"></div>
      </div>
    `;
    this.el = el;
    this.statusEl = el.querySelector(".ng-editor-status");
    this.typeSelectEl = el.querySelector(".ng-window-editor-add-type");
    for (const type of WIDGET_TYPES) {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      this.typeSelectEl.appendChild(opt);
    }
    this.structureEl = el.querySelector(".ng-window-editor-structure");
    this.previewEl = el.querySelector(".ng-window-editor-preview");
    this.inspectorEl = el.querySelector(".ng-window-editor-inspector");
    el.addEventListener("click", (e) => {
      const button = e.target.closest("[data-action]");
      if (button) this._onAction(button.dataset.action);
    });
  }

  _bindKeys() {
    this.el.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this._onAction("delete");
      }
    });
  }

  _onAction(action) {
    const selectedId = this.model.getSelectedId();
    switch (action) {
      case "undo": this.model.undo(); break;
      case "redo": this.model.redo(); break;
      case "add": this.model.addWidget(this.typeSelectEl.value, selectedId || "root"); break;
      case "duplicate": if (selectedId) this.model.duplicateWidget(selectedId); break;
      case "delete": if (selectedId) this.model.removeWidget(selectedId); break;
      case "save": this._save(); return;
      case "download": downloadTextFile(this.dataFileName || `${this.model.definition.id}.json`, JSON.stringify(this.model.toDefinition(), null, 2)); return;
      case "write-disk": this._writeDisk(); return;
      default: return;
    }
    this.render();
  }

  _save() {
    this.onSaveToMemory(this.model.toDefinition());
    this.statusEl.textContent = "已保存到内存";
  }

  async _writeDisk() {
    if (!this.dataFileName) return;
    try {
      await writeDataFile(this.dataFileName, JSON.stringify(this.model.toDefinition(), null, 2));
      this.statusEl.textContent = "已写入磁盘";
    } catch (err) {
      this.statusEl.textContent = `写入失败: ${err.message}`;
    }
  }

  render() {
    this._renderStructure();
    this._renderPreview();
    this._renderInspector();
  }

  _renderStructure() {
    this.structureEl.innerHTML = "";
    const selectedId = this.model.getSelectedId();
    const renderNode = (node, depth) => {
      const row = document.createElement("div");
      row.className = "ng-window-editor-structure-row";
      row.style.paddingLeft = `${depth * 14}px`;
      row.dataset.widgetId = node.widgetId;
      row.draggable = node.widgetId !== "root";
      row.textContent = `${node.type} (${node.widgetId})`;
      row.classList.toggle("selected", node.widgetId === selectedId);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.model.select(node.widgetId);
        this.render();
      });
      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/widget-id", node.widgetId);
      });
      if (node.type === "container") {
        row.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const draggedId = e.dataTransfer.getData("text/widget-id");
          if (draggedId) this.model.moveWidget(draggedId, node.widgetId, null);
          this.render();
        });
      }
      this.structureEl.appendChild(row);
      if (node.type === "container") {
        for (const child of node.children || []) renderNode(child, depth + 1);
      }
    };
    renderNode(this.model.definition.root, 0);
  }

  _renderPreview() {
    this.previewEl.innerHTML = "";
    const { el } = renderWindowRoot(this.model.definition.root, {});
    el.addEventListener("click", (e) => {
      const target = e.target.closest("[data-widget-id]");
      if (!target) return;
      e.stopPropagation();
      this.model.select(target.dataset.widgetId);
      this.render();
    });
    this.previewEl.appendChild(el);
  }

  _renderInspector() {
    this.inspectorEl.innerHTML = "";
    const node = this.model.getSelected();
    if (!node) {
      // Mirrors ActivityEditorView's convention: with nothing selected the
      // inspector shows the window's own metadata instead of going blank.
      this._renderWindowMetaInspector();
      return;
    }
    const fields = this._fieldsFor(node);
    for (const field of fields) {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
      const input = document.createElement(field.type === "checkbox" ? "input" : field.type === "select" ? "select" : "input");
      if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "number") {
        input.type = "number";
        input.value = field.value ?? "";
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        input.type = "text";
        input.value = field.value ?? "";
      }
      // Text inputs only patch the model on "input" and never trigger a
      // full re-render mid-typing, so focus is never lost (plan §7.3
      // "输入框 text 事件只更新现有 inspector 值，不整体重绘导致失焦").
      input.addEventListener("input", () => {
        const value = field.type === "checkbox" ? input.checked : field.type === "number" ? Number(input.value) : input.value;
        this.model.updateWidgetProps(node.widgetId, { [field.key]: value });
        this._renderStructure();
        this._renderPreview();
      });
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
  }

  _renderWindowMetaInspector() {
    const definition = this.model.definition;
    const fields = [
      { key: "title", label: "title", type: "text", value: definition.title || "" },
      { key: "mode", label: "mode", type: "select", options: ["window", "custom"], value: definition.mode || "window" },
      { key: "fullscreen", label: "fullscreen", type: "checkbox", value: Boolean(definition.fullscreen) },
    ];
    for (const field of fields) {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${field.label}</span>`;
      const input = document.createElement(field.type === "select" ? "select" : "input");
      if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(field.value);
      } else if (field.type === "select") {
        for (const option of field.options) {
          const opt = document.createElement("option");
          opt.value = option;
          opt.textContent = option;
          input.appendChild(opt);
        }
        input.value = field.value ?? "";
      } else {
        input.type = "text";
        input.value = field.value ?? "";
      }
      input.addEventListener("input", () => {
        const value = field.type === "checkbox" ? input.checked : input.value;
        this.model.updateWindowProps({ [field.key]: value });
      });
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
  }

  _fieldsFor(node) {
    const common = [{ key: "widgetId", label: "widgetId", type: "text", value: node.widgetId }];
    if (node.type === "container") {
      return [
        ...common,
        { key: "flow", label: "flow", type: "select", options: ["vertical", "horizontal", "grid", "stack"], value: node.flow || "vertical" },
        { key: "gap", label: "gap", type: "number", value: node.gap ?? 0 },
        { key: "padding", label: "padding", type: "number", value: node.padding ?? 0 },
        { key: "align", label: "align", type: "text", value: node.align || "" },
        { key: "justify", label: "justify", type: "text", value: node.justify || "" },
      ];
    }
    if (node.type === "label" || node.type === "button") {
      return [...common, { key: "text", label: "text", type: "text", value: node.text || "" }];
    }
    if (node.type === "image") {
      return [...common, { key: "src", label: "src", type: "text", value: node.src || "" }, { key: "alt", label: "alt", type: "text", value: node.alt || "" }];
    }
    return [...common, { key: "value", label: "value", type: "text", value: node.value ?? "" }];
  }
}

export default WindowEditorView;
// DEV-TOOLS:END
