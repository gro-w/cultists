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
  constructor({ eventBus, keywordManager, spellManager } = {}) {
    this.eventBus = eventBus;
    this.keywordManager = keywordManager;
    this.spellManager = spellManager;
    this.activeTab = "keywords";
    this._buildDom();
    this._unsubscribers = [
      eventBus.on("keyword:collected", () => this._render()),
      eventBus.on("keyword:removed", () => this._render()),
      eventBus.on("spell:learned", () => this._render()),
      eventBus.on("spell:cast", () => this._render()),
    ];
    this._render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-notebook-view";
    el.innerHTML = `
      <div class="ng-notebook-tabs">
        <button type="button" data-tab="keywords">🔑 关键词</button>
        <button type="button" data-tab="spells">✨ 法术</button>
      </div>
      <div class="ng-notebook-list"></div>`;
    this.el = el;
    this.listEl = el.querySelector(".ng-notebook-list");
    el.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      this.activeTab = button.dataset.tab;
      this._render();
    }));
  }

  _render() {
    this.el.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === this.activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const entries = this.keywordManager.all();
    this.listEl.innerHTML = "";
    if (this.activeTab === "spells") {
      const spells = this.spellManager?.all?.() || [];
      if (!spells.length) {
        this.listEl.innerHTML = "<p class=\"ng-notebook-empty\">尚未学习任何法术。<br><small>在 0&lt;SAN≤50 时使用可学习的书籍即可开始学习。</small></p>";
        return;
      }
      spells.forEach((spell) => {
        const card = document.createElement("div");
        card.className = "ng-notebook-spell";
        const title = document.createElement("strong");
        title.textContent = spell.name || spell.id;
        const source = document.createElement("span");
        source.textContent = `来自《${spell.sourceBookName || spell.sourceBookId || "未知书籍"}》`;
        const description = document.createElement("p");
        description.textContent = spell.description || "（无效果描述）";
        const footer = document.createElement("div");
        footer.className = "ng-notebook-spell-footer";
        footer.textContent = "⏱ 学习 4h · 💀 施放 5 SAN";
        const cast = document.createElement("button");
        cast.type = "button";
        cast.textContent = "施放";
        cast.addEventListener("click", () => {
          const result = this.spellManager.cast(spell.id);
          footer.textContent = result.message || footer.textContent;
        });
        footer.appendChild(cast);
        card.append(title, source, description, footer);
        this.listEl.appendChild(card);
      });
      return;
    }
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
      const content = document.createElement("span");
      content.className = "ng-notebook-content";
      content.textContent = entry.content || entry.id;
      const source = document.createElement("span");
      source.className = "ng-notebook-source";
      source.textContent = entry.source || "未知来源";
      const day = document.createElement("span");
      day.className = "ng-notebook-day";
      day.textContent = `第${entry.collectedDay ?? "?"}天`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", () => this.keywordManager.remove(entry.id));
      item.append(content, source, day, remove);
      this.listEl.appendChild(item);
    });
  }

  destroy() {
    this._unsubscribers.forEach((fn) => fn());
  }
}

export default NotebookView;
