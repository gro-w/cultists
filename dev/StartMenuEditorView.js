// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { writeDataFile } from "./devApi.js";

/** Edits the Start menu projection of the canonical desktop icon registry. */
export class StartMenuEditorView {
  constructor({ iconManager } = {}) {
    this.iconManager = iconManager;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-start-menu-editor";
    this.el.innerHTML = `<div class="ng-list-manager-toolbar"><button type="button" data-action="save">${t("legacy.81ee3266b03d")}</button><span class="ng-editor-status"></span></div><div class="ng-start-menu-editor-list"></div>`;
    this.listEl = this.el.querySelector(".ng-start-menu-editor-list");
    this.statusEl = this.el.querySelector(".ng-editor-status");
    this.el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("desktop-icons.json", JSON.stringify(this.iconManager.toJSON(), null, 2));
        this.statusEl.textContent = t("legacy.d4371481b26a");
      } catch (error) {
        this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
      }
    });
  }

  render() {
    this.listEl.replaceChildren();
    for (const icon of this.iconManager.list()) {
      const row = document.createElement("label");
      row.className = "ng-start-menu-editor-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = icon.startMenu !== false;
      checkbox.disabled = icon.iconId === "dev-mode-launcher-icon";
      checkbox.addEventListener("change", () => {
        this.iconManager.setStartMenu(icon.iconId, checkbox.checked);
        this.render();
      });
      const text = document.createElement("span");
      text.textContent = `${icon.glyph || "📦"} ${icon.label || icon.iconId}`;
      row.append(checkbox, text);
      this.listEl.appendChild(row);
    }
  }
}

export default StartMenuEditorView;
// DEV-TOOLS:END
