import { eventBus } from "../core/EventBus.js";
import { i18n } from "../core/I18n.js";

/**
 * NotificationBanner - a small auto-dismissing toast shown whenever the
 * day/night phase changes, announcing which phase/app just became active.
 */
export default class NotificationBanner {
  /** @param {HTMLElement} containerEl */
  constructor(containerEl) {
    this.containerEl = containerEl;
    this._timer = null;
    this._onTransitionEnd = null;
    eventBus.on("daynight:changed", ({ phase }) =>
      this.show(i18n.t(`notification.${phase}`, ""))
    );
  }

  /** Show the "welcome back" toast used when resuming from a save string. */
  showWelcomeBack() {
    this.show(i18n.t("notification.welcomeBack", ""));
  }

  show(message) {
    if (!message) return;
    clearTimeout(this._timer);
    if (this._onTransitionEnd) {
      this.containerEl.removeEventListener("transitionend", this._onTransitionEnd);
      this._onTransitionEnd = null;
    }
    this.containerEl.textContent = message;
    this.containerEl.classList.remove("hidden");
    // Force reflow so the opacity transition re-triggers even if a previous
    // banner was still fading in/out.
    void this.containerEl.offsetWidth;
    this.containerEl.classList.add("visible");
    this._timer = setTimeout(() => {
      this.containerEl.classList.remove("visible");
      this._onTransitionEnd = () => {
        this.containerEl.classList.add("hidden");
        this.containerEl.removeEventListener("transitionend", this._onTransitionEnd);
        this._onTransitionEnd = null;
      };
      this.containerEl.addEventListener("transitionend", this._onTransitionEnd);
    }, 4000);
  }
}
