// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";

/**
 * DesktopIconEditorView - developer-mode editor for `data/desktop-icons.json`
 * (plan §8.2 "拖动图标调整位置/选择图标顺序/更换 logo 和显示名/指定双击行为").
 * Operates directly on the live `DesktopIconManager` instance shared with
 * the running desktop (so edits preview immediately via `refreshIcons`),
 * and persists via the same `writeDataFile` used by every other editor.
 * Icons only ever reference a stable `blueprintId` + `inputs` (plan §8.2
 * "不在图标数据中内联另一套执行器") - this view edits exactly those two
 * fields as free-form text/JSON, never a bespoke per-behaviour form.
 */
export class DesktopIconEditorView {
  constructor({ iconManager, refreshIcons } = {}) {
    this.iconManager = iconManager;
    this.refreshIcons = refreshIcons || (() => {});
    this.selectedIconId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-icon">新建图标</button>
          <button type="button" data-action="delete-icon">删除图标</button>
          <button type="button" data-action="move-up">上移</button>
          <button type="button" data-action="move-down">下移</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="save">写入磁盘</button>
          <span class="ng-editor-status"></span>
        </div>
        <div class="ng-window-editor-fields"></div>
      </div>
    `;
    this.el = el;
    this.listEl = el.querySelector(".ng-list-manager-list-items");
    this.fieldsEl = el.querySelector(".ng-window-editor-fields");
    this.statusEl = el.querySelector(".ng-editor-status");

    el.querySelector('[data-action="new-icon"]').addEventListener("click", () => {
      const iconId = prompt("新图标 iconId:");
      if (!iconId) return;
      this.iconManager.register({ iconId, label: iconId, blueprintId: "desktop.open-window", inputs: {} });
      this.selectedIconId = iconId;
      this._commit();
    });
    el.querySelector('[data-action="delete-icon"]').addEventListener("click", () => {
      if (!this.selectedIconId) return;
      this.iconManager.unregister(this.selectedIconId);
      this.selectedIconId = null;
      this._commit();
    });
    el.querySelector('[data-action="move-up"]').addEventListener("click", () => this._move(-1));
    el.querySelector('[data-action="move-down"]').addEventListener("click", () => this._move(1));
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("desktop-icons.json", JSON.stringify(this.iconManager.toJSON(), null, 2));
        this.statusEl.textContent = "已写入磁盘";
      } catch (err) {
        this.statusEl.textContent = `写入失败: ${err.message}`;
      }
    });
  }

  _move(delta) {
    if (!this.selectedIconId) return;
    const list = this.iconManager.list();
    const index = list.findIndex((icon) => icon.iconId === this.selectedIconId);
    if (index === -1) return;
    this.iconManager.reorder(this.selectedIconId, index + delta);
    this._commit();
  }

  /** Re-renders this editor and pushes the change to the live desktop immediately (plan: 编辑器与运行时使用同一渲染器/位置数据). */
  _commit() {
    this.refreshIcons();
    this.render();
  }

  render() {
    this.listEl.innerHTML = "";
    const icons = this.iconManager.list();
    for (const icon of icons) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (icon.iconId === this.selectedIconId ? " selected" : "");
      row.textContent = `${icon.glyph} ${icon.label} (${icon.iconId})`;
      row.addEventListener("click", () => {
        this.selectedIconId = icon.iconId;
        this.render();
      });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const icon = this.iconManager.get(this.selectedIconId);
    if (!icon) {
      this.fieldsEl.textContent = "选择一个图标以编辑";
      return;
    }
    const makeField = (label, value, onChange, type = "text") => {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${label}</span>`;
      const input = document.createElement(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") input.type = type;
      input.value = value;
      input.addEventListener("change", () => { onChange(input.value); this._commit(); });
      row.appendChild(input);
      this.fieldsEl.appendChild(row);
    };
    makeField("显示名", icon.label, (value) => this.iconManager.setLabel(icon.iconId, value));
    makeField("Logo (emoji/text)", icon.glyph, (value) => this.iconManager.setLogo(icon.iconId, value));
    makeField("位置模式", icon.position.mode, (value) => {
      if (value === "free") this.iconManager.setFreePosition(icon.iconId, icon.position.x || 0, icon.position.y || 0);
      else this.iconManager.reorder(icon.iconId, icon.order);
    });
    if (icon.position.mode === "free") {
      makeField("x", String(icon.position.x || 0), (value) => this.iconManager.setFreePosition(icon.iconId, Number(value) || 0, icon.position.y || 0), "number");
      makeField("y", String(icon.position.y || 0), (value) => this.iconManager.setFreePosition(icon.iconId, icon.position.x || 0, Number(value) || 0), "number");
    }
    makeField("blueprintId", icon.blueprintId, (value) => this.iconManager.setBlueprint(icon.iconId, value, icon.inputs));
    makeField("inputs (JSON)", JSON.stringify(icon.inputs, null, 2), (value) => {
      try {
        this.iconManager.setBlueprint(icon.iconId, icon.blueprintId, JSON.parse(value || "{}"));
      } catch (err) {
        this.statusEl.textContent = `inputs 不是合法 JSON: ${err.message}`;
      }
    }, "textarea");
  }
}

export default DesktopIconEditorView;
// DEV-TOOLS:END
