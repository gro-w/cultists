import { eventBus } from "../core/EventBus.js";

/**
 * AchievementToast – lightweight queued notification that fires whenever an
 * achievement is unlocked.  Lives in the desktop layer (same level as
 * NotificationBanner) and reuses the existing .notification-banner styles.
 *
 * Unlike NotificationBanner (single slot, latest wins) this component queues
 * multiple unlocks and shows them one after another so no unlock is dropped.
 *
 * Each toast shows for 4 s, then transitions out before the next one appears.
 *
 * Usage: `new AchievementToast(containerEl)` – containerEl is a dedicated
 * div added to index.html (separate from #notification-banner to avoid
 * clobbering day/night phase toasts).
 *
 * The toast is clickable: clicking it opens the Achievements app window (if a
 * launcher is registered via `setLauncher(fn)`).
 */
export default class AchievementToast {
  /** @param {HTMLElement} containerEl */
  constructor(containerEl) {
    this.containerEl = containerEl;
    this._queue = [];
    this._busy = false;
    this._timer = null;
    this._onTransitionEnd = null;
    this._launcher = null;

    eventBus.on("achievement:unlocked", ({ def }) => {
      this._enqueue(def);
    });

    // Clicking the toast opens the achievements app
    this.containerEl.addEventListener("click", () => {
      if (this._launcher) this._launcher();
    });
  }

  /** Register a function that opens the Achievements app window. */
  setLauncher(fn) {
    this._launcher = fn;
  }

  _enqueue(def) {
    this._queue.push(def);
    if (!this._busy) this._showNext();
  }

  _showNext() {
    if (this._queue.length === 0) {
      this._busy = false;
      return;
    }
    this._busy = true;
    const def = this._queue.shift();
    this._show(def);
  }

  _show(def) {
    clearTimeout(this._timer);
    if (this._onTransitionEnd) {
      this.containerEl.removeEventListener("transitionend", this._onTransitionEnd);
      this._onTransitionEnd = null;
    }

    const icon = def.icon || "🏅";
    this.containerEl.innerHTML = `
      <span class="ach-toast-badge">${icon}</span>
      <span class="ach-toast-body">
        <span class="ach-toast-label">成就解锁！</span>
        <span class="ach-toast-title">${def.title}</span>
        <span class="ach-toast-desc">${def.description}</span>
      </span>
    `;
    this.containerEl.classList.remove("hidden");
    void this.containerEl.offsetWidth; // force reflow for transition
    this.containerEl.classList.add("visible");

    this._timer = setTimeout(() => {
      this.containerEl.classList.remove("visible");
      this._onTransitionEnd = () => {
        this.containerEl.classList.add("hidden");
        this.containerEl.removeEventListener("transitionend", this._onTransitionEnd);
        this._onTransitionEnd = null;
        // Small gap between toasts
        setTimeout(() => this._showNext(), 300);
      };
      this.containerEl.addEventListener("transitionend", this._onTransitionEnd);
    }, 4000);
  }
}
