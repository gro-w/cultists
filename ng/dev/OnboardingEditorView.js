// DEV-TOOLS:START
import { writeDataFile } from "./devApi.js";

/**
 * OnboardingEditorView - visual editor for `data/onboarding.json` (the
 * new-手引导 hint content OnboardingManager.loadHints() reads). Mirrors
 * PublicVariableEditorView's list+detail layout: operates directly on the
 * live `OnboardingManager` instance (so edits preview immediately - a hint
 * whose `trigger` milestone was already marked can be re-requested via the
 * "预览" button), and persists via the shared `writeDataFile`. A hint is
 * `{id, trigger, completeOn, target, title, text}` - the exact shape
 * `TutorialOverlay`/`markOnboardingMilestone` already consume, so this
 * editor never needs engine changes to add a new hint.
 */
export class OnboardingEditorView {
  constructor({ onboardingManager } = {}) {
    this.onboardingManager = onboardingManager;
    this.selectedHintId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-list-manager";
    el.innerHTML = `
      <div class="ng-list-manager-lists">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new-hint">新建提示</button>
          <button type="button" data-action="delete-hint">删除提示</button>
        </div>
        <div class="ng-list-manager-list-items"></div>
      </div>
      <div class="ng-list-manager-activities">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="preview">预览此提示</button>
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

    el.querySelector('[data-action="new-hint"]').addEventListener("click", () => {
      const id = prompt("新提示 id:");
      if (!id) return;
      if (this._hints().some((hint) => hint.id === id)) {
        this.statusEl.textContent = `提示 id "${id}" 已存在`;
        return;
      }
      const hints = [...this._hints(), { id, trigger: "", completeOn: "", target: "", title: "", text: "" }];
      this._applyHints(hints);
      this.selectedHintId = id;
      this.render();
    });
    el.querySelector('[data-action="delete-hint"]').addEventListener("click", () => {
      if (!this.selectedHintId) return;
      this._applyHints(this._hints().filter((hint) => hint.id !== this.selectedHintId));
      this.selectedHintId = null;
      this.render();
    });
    el.querySelector('[data-action="preview"]').addEventListener("click", () => {
      const hint = this._hints().find((h) => h.id === this.selectedHintId);
      if (!hint) return;
      this.onboardingManager.eventBus?.emit("onboarding:hint_requested", { ...hint });
    });
    el.querySelector('[data-action="save"]').addEventListener("click", async () => {
      try {
        await writeDataFile("onboarding.json", JSON.stringify(this._hints(), null, 2));
        this.statusEl.textContent = "已写入磁盘";
      } catch (err) {
        this.statusEl.textContent = `写入失败: ${err.message}`;
      }
    });
  }

  _hints() {
    return this.onboardingManager.list();
  }

  /** Replaces the live manager's hint list (does not touch milestone/shown/dismissed progress - same contract as `loadHints`). */
  _applyHints(hints) {
    this.onboardingManager.loadHints(hints);
  }

  render() {
    this.listEl.innerHTML = "";
    for (const hint of this._hints()) {
      const row = document.createElement("div");
      row.className = "ng-list-manager-list-item" + (hint.id === this.selectedHintId ? " selected" : "");
      row.textContent = `${hint.title || hint.id} (${hint.id})`;
      row.addEventListener("click", () => {
        this.selectedHintId = hint.id;
        this.render();
      });
      this.listEl.appendChild(row);
    }
    this._renderFields();
  }

  _renderFields() {
    this.fieldsEl.innerHTML = "";
    const hint = this._hints().find((h) => h.id === this.selectedHintId);
    if (!hint) {
      this.fieldsEl.textContent = "选择一个提示以编辑";
      return;
    }
    const makeField = (label, key, type = "text") => {
      const row = document.createElement("label");
      row.className = "ng-window-editor-field";
      row.innerHTML = `<span>${label}</span>`;
      const input = document.createElement(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") input.type = type;
      input.value = hint[key] || "";
      input.addEventListener("change", () => {
        const hints = this._hints().map((h) => (h.id === hint.id ? { ...h, [key]: input.value } : h));
        this._applyHints(hints);
        this.render();
      });
      row.appendChild(input);
      this.fieldsEl.appendChild(row);
    };
    makeField("触发里程碑 (trigger)", "trigger");
    makeField("完成里程碑 (completeOn)", "completeOn");
    makeField("目标 CSS 选择器 (target)", "target");
    makeField("标题 (title)", "title");
    makeField("正文 (text)", "text", "textarea");
  }
}

export default OnboardingEditorView;
// DEV-TOOLS:END
