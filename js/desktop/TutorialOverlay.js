import { eventBus } from "../core/EventBus.js";
import { onboardingManager } from "../core/OnboardingManager.js";

export default class TutorialOverlay {
  constructor(root, manager = onboardingManager) {
    this.root = root;
    this.manager = manager;
    this._off = eventBus.on("onboarding:hint_requested", (hint) => this.show(hint));
    this._hint = null;
    this._pendingHints = [];
    this.root.className = "tutorial-overlay hidden";
    this.root.innerHTML = `<div class="tutorial-highlight" aria-hidden="true"></div><div class="tutorial-card" role="dialog" aria-live="polite"><strong class="tutorial-title"></strong><p class="tutorial-text"></p><div class="tutorial-actions"><button type="button" class="win95-btn bevel-out tutorial-ok">知道了</button><button type="button" class="win95-btn bevel-out tutorial-dismiss">以后不再提示</button></div></div>`;
    this.highlight = this.root.querySelector(".tutorial-highlight");
    this.card = this.root.querySelector(".tutorial-card");
    this.title = this.root.querySelector(".tutorial-title");
    this.text = this.root.querySelector(".tutorial-text");
    this.root.querySelector(".tutorial-ok").addEventListener("click", () => this.close());
    this.root.querySelector(".tutorial-dismiss").addEventListener("click", () => { if (this._hint) this.manager.dismissHint(this._hint.id); this.close(); });
    this.root.addEventListener("keydown", (event) => { if (event.key === "Escape") this.close(); });
    this._onResize = () => this._position();
    window.addEventListener("resize", this._onResize);
  }
  show(hint) {
    if (!this.root.classList.contains("hidden")) {
      if (!this._pendingHints.some((queued) => queued.id === hint.id)) this._pendingHints.push(hint);
      return;
    }
    this._hint = hint;
    this.title.textContent = hint.title;
    this.text.textContent = hint.text;
    this.root.classList.remove("hidden");
    this._position();
    this.root.querySelector(".tutorial-ok").focus();
  }
  _position() {
    if (!this._hint) return;
    const target = document.querySelector(this._hint.target);
    if (!target || !target.getBoundingClientRect().width) { this.highlight.classList.add("hidden"); this.card.classList.add("tutorial-card-centered"); return; }
    const rect = target.getBoundingClientRect();
    this.highlight.classList.remove("hidden"); this.card.classList.remove("tutorial-card-centered");
    Object.assign(this.highlight.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    this.card.style.left = `${Math.min(window.innerWidth - 320, Math.max(12, rect.left))}px`;
    this.card.style.top = `${Math.min(window.innerHeight - 150, rect.bottom + 12)}px`;
  }
  close() {
    this.root.classList.add("hidden");
    this._hint = null;
    const next = this._pendingHints.shift();
    if (next) this.show(next);
  }
  destroy() { this._off(); window.removeEventListener("resize", this._onResize); }
}