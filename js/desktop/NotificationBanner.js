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
    eventBus.on("daynight:changed", ({ phase, settlement }) => {
      // A settlement (ActionBudget.settlePhase(), see DayNightSystem.toggle)
      // takes priority over the plain "phase changed" toast, since it's the
      // more actionable piece of news (加班/熬夜 consequence just landed).
      const settlementMessage = this._settlementMessage(settlement);
      this.show(settlementMessage || i18n.t(`notification.${phase}`, ""));
    });
    eventBus.on("npc:offline", ({ actorId }) => {
      this.show(i18n.t("notification.npcOffline", `⚠️ ${actorId} 情绪崩溃，已下线，额外工作压到了你身上。`));
    });
  }

  _settlementMessage(settlement) {
    if (!settlement || !settlement.kind) return null;
    if (settlement.kind === "overtime") {
      return i18n.t(
        "notification.overtime",
        `🚪 今天加班超时了 ${settlement.totalOverage} 次，侵占了今晚的时间（夜间可用次数减少）。`
      ).replace("{n}", settlement.totalOverage);
    }
    if (settlement.kind === "allnighter") {
      const message = i18n.t(
        "notification.allnighter",
        `🌙 昨晚睡眠 ${settlement.sleepMinutes} 分钟，熬夜损失 ${settlement.sanLoss} 点精神，恢复 ${settlement.recoveredSan} 点。`
      );
      return message
        .replace("{minutes}", settlement.sleepMinutes)
        .replace("{loss}", settlement.sanLoss)
        .replace("{recovered}", settlement.recoveredSan)
        .concat(settlement.sleepDebtSanLoss ? ` 连续三天睡眠不足，额外损失 ${settlement.sleepDebtSanLoss} 点精神。` : "");
    }
    return null;
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
