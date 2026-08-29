import { endingManager } from "../core/EndingManager.js";
import { i18n } from "../core/I18n.js";
import { scheduleData } from "../core/ScheduleData.js";
import { mainQueue } from "../core/ScheduleQueue.js";
import { createScheduleRunner } from "../core/ScheduleRunner.js";

/**
 * EndingScreen - full-page overlay shown when EndingManager fires any
 * ending (event/item/stat/time-triggered). Blueprint-backed endings are
 * executed through the normal main queue and ScheduleRunner before the
 * final title card is shown. Legacy title-only endings keep the old card.
 */
export default class EndingScreen {
  /** @param {HTMLElement} rootEl - container element (e.g. #ending-screen) */
  constructor(rootEl) {
    this.rootEl = rootEl;
    this._runToken = 0;
    endingManager.onEnding((def) => this.show(def));
    endingManager.onReset(() => this.hide());
  }

  show(def) {
    const token = ++this._runToken;
    this.rootEl.innerHTML = `
      <div class="crt-screen">
        <div class="ending-screen-panel">
          <div class="ending-screen-icon">${def.icon || "🌑"}</div>
          <h2 class="ending-screen-title">${def.title || ""}</h2>
          <div class="ending-schedule-status">正在加载结局日程……</div>
          <div class="ending-schedule-log" aria-live="polite"></div>
          <div class="dialogue-options ending-schedule-options"></div>
          <div class="ending-final hidden">
            <p class="ending-screen-text"></p>
            <button type="button" class="crt-btn ending-screen-btn">
              ${i18n.t("ending.backToMenu", "返回主菜单")}
            </button>
          </div>
        </div>
      </div>
    `;
    this.rootEl.classList.remove("hidden");
    const finish = () => {
      if (token !== this._runToken) return;
      const finalEl = this.rootEl.querySelector(".ending-final");
      const statusEl = this.rootEl.querySelector(".ending-schedule-status");
      if (statusEl) statusEl.remove();
      if (finalEl) {
        finalEl.querySelector(".ending-screen-text").textContent = def.text || "";
        finalEl.classList.remove("hidden");
        finalEl.querySelector(".ending-screen-btn").addEventListener("click", () => {
          window.location.href = window.location.pathname;
        });
      }
    };

    const playbackScheduleId = def.blueprintScheduleId || def.id;
    const playbackDefinition = def.blueprint || def.dialogueTree
      ? def
      : scheduleData.definition(playbackScheduleId);
    if (!(playbackDefinition?.blueprint || playbackDefinition?.dialogueTree)) {
      finish();
      return;
    }

    const logEl = this.rootEl.querySelector(".ending-schedule-log");
    const optionsEl = this.rootEl.querySelector(".ending-schedule-options");
    const statusEl = this.rootEl.querySelector(".ending-schedule-status");
    const appendLine = (speaker, label, text) => {
      if (token !== this._runToken) return;
      const speakerLabels = { player: "主控", awei: "阿伟", binbin: "彬彬", narrator: "旁白" };
      const speakerIds = { 主控: "player", 彬彬: "binbin", 旁白: "narrator" };
      const fallbackSpeaker = speakerLabels[speaker] || label || speaker || "日程";
      String(text ?? "").split(/\r?\n/).forEach((rawLine) => {
        const content = rawLine.trim();
        if (!content) return;
        const match = content.match(/^(旁白|彬彬|主控)：\s*(.*)$/);
        const lineSpeaker = match ? speakerIds[match[1]] : speaker;
        const lineLabel = match ? match[1] : fallbackSpeaker;
        const lineText = match ? match[2] : content;
        const line = document.createElement("p");
        line.className = `ending-dialogue-line ending-dialogue-${lineSpeaker || "npc"}`;
        const speakerEl = document.createElement("strong");
        speakerEl.textContent = `${lineLabel}：`;
        const textEl = document.createElement("span");
        textEl.textContent = lineText;
        line.append(speakerEl, textEl);
        logEl.appendChild(line);
      });
      logEl.scrollTop = logEl.scrollHeight;
    };

    scheduleData.createInstance(playbackScheduleId, "main").then(({ ok, instance, reason }) => {
      if (token !== this._runToken) return;
      if (!ok || !instance) throw new Error(`无法创建结局日程：${reason || "unknown"}`);
      instance.currentNodeId = playbackDefinition.blueprint?.startNodeId
        || playbackDefinition.startNodeId
        || null;
      instance.executedNodeIds = [];
      instance.transcript = [];
      const runner = createScheduleRunner({
        definition: playbackDefinition,
        instance,
        appendLine,
        optionsEl,
        appId: "ending",
        onCheckpoint: (next) => mainQueue.updateInstance(instance.instanceId, next),
        onComplete: (next) => {
          mainQueue.complete(next.instanceId);
          if (statusEl) statusEl.textContent = "结局日程已完成";
          finish();
        },
      });
      runner.start();
    }).catch((error) => {
      if (token !== this._runToken) return;
      console.error("[EndingScreen] Failed to execute ending blueprint:", error);
      if (statusEl) statusEl.textContent = "结局日程执行失败，已显示结局结果";
      finish();
    });
  }

  hide() {
    this._runToken += 1;
    this.rootEl.classList.add("hidden");
    this.rootEl.replaceChildren();
  }
}
