/**
 * SaveLoadView - the player-facing "使用显式保存按钮和下载文件" entry point
 * (plan §12.3). Turns `SaveManager.snapshot()` into a downloaded JSON file
 * and turns a user-picked JSON file back into a `SaveManager.restore()`
 * call; every actual read/write of game state stays inside SaveManager -
 * this view only owns the DOM file-picker/download mechanics.
 */
export class SaveLoadView {
  constructor({ saveManager } = {}) {
    this.saveManager = saveManager;
    this._buildDom();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-save-load-view";
    el.innerHTML = `
      <p>保存当前进度到一个文件，或从之前保存的文件恢复进度。</p>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="save">保存到文件</button>
        <button type="button" data-action="load">从文件加载</button>
        <input type="file" accept="application/json" style="display:none" data-role="file-input" />
      </div>
      <span class="ng-editor-status"></span>
    `;
    this.el = el;
    this.statusEl = el.querySelector(".ng-editor-status");
    this.fileInput = el.querySelector('[data-role="file-input"]');

    el.querySelector('[data-action="save"]').addEventListener("click", () => this._save());
    el.querySelector('[data-action="load"]').addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => this._load());
  }

  _save() {
    try {
      const envelope = this.saveManager.snapshot();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cultists-ng-save-day${envelope.state.gameClock.day}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.statusEl.textContent = "已保存到文件";
    } catch (err) {
      this.statusEl.textContent = `保存失败: ${err.message}`;
    }
  }

  _load() {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const envelope = JSON.parse(String(reader.result));
        this.saveManager.restore(envelope);
        this.statusEl.textContent = "已加载存档";
      } catch (err) {
        // A bad/corrupt file must never touch live state - SaveManager.restore()
        // itself guarantees this; here we just surface the error (plan §12.3
        // "恢复失败不覆盖当前有效状态").
        this.statusEl.textContent = `加载失败: ${err.message}`;
      }
    };
    reader.onerror = () => { this.statusEl.textContent = "读取文件失败"; };
    reader.readAsText(file);
  }
}

export default SaveLoadView;
