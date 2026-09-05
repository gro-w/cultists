/**
 * NotebookView - the player-facing list of collected keywords (plan §8
 * "关键词的收集"), sourced entirely from the generic `KeywordManager`
 * (no dialogue/his/item specific code here). Refreshes on both
 * `keyword:collected` and `keyword:removed` so it always reflects the
 * live notebook, and re-renders (instead of a fragile per-item diff)
 * since the notebook is expected to stay small (tens, not thousands, of
 * entries) for the lifetime of a save.
 */
export class NotebookView {
  constructor({ eventBus, keywordManager } = {}) {
    this.eventBus = eventBus;
    this.keywordManager = keywordManager;
    this._buildDom();
    this._unsubscribers = [
      eventBus.on("keyword:collected", () => this._render()),
      eventBus.on("keyword:removed", () => this._render()),
    ];
    this._render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-notebook-view";
    el.innerHTML = `<div class="ng-notebook-list"></div>`;
    this.el = el;
    this.listEl = el.querySelector(".ng-notebook-list");
  }

  _render() {
    const entries = this.keywordManager.all();
    this.listEl.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ng-notebook-empty";
      empty.textContent = "暂无收集的关键词。";
      this.listEl.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "ng-notebook-item";
      item.innerHTML = `
        <span class="ng-notebook-content">${entry.content || entry.id}</span>
        <span class="ng-notebook-day">第${entry.collectedDay ?? "?"}天</span>
      `;
      this.listEl.appendChild(item);
    });
  }

  destroy() {
    this._unsubscribers.forEach((fn) => fn());
  }
}

export default NotebookView;
