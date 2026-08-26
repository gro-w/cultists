import { eventBus } from "../core/EventBus.js";

const PHASE_MESSAGES = {
  day: "☀ 新的一天开始了，HIS 医疗系统已开启。",
  night: "🌙 夜晚降临，社交软件已开启。",
};

/**
 * NotificationBanner - a small auto-dismissing toast shown whenever the
 * day/night phase changes, announcing which phase/app just became active.
 */
export default class NotificationBanner {
  /** @param {HTMLElement} containerEl */
  constructor(containerEl) {
    this.containerEl = containerEl;
    this._timer = null;
    eventBus.on("daynight:changed", ({ phase }) => this.show(PHASE_MESSAGES[phase] || ""));
  }

  show(message) {
    if (!message) return;
    this.containerEl.textContent = message;
    this.containerEl.classList.remove("hidden");
    this.containerEl.classList.add("visible");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.containerEl.classList.remove("visible");
      this.containerEl.classList.add("hidden");
    }, 4000);
  }
}
