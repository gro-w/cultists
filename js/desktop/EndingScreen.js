import { endingManager } from "../core/EndingManager.js";
import { i18n } from "../core/I18n.js";
import { dataLoader } from "../core/DataLoader.js";
import { eventBus } from "../core/EventBus.js";
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
    this._eventOffs = [];
    this._debugEventEndingId = null;
    endingManager.onEnding((nextDef) => {
      if (this._debugEventEndingId === String(nextDef.id)) {
        this._debugEventEndingId = null;
        return;
      }
      this.show(nextDef);
    });
    endingManager.onReset(() => this.hide());
    eventBus.on("ending:debug-event-requested", ({ endingId, ending, event }) => {
      if (!endingId || !ending || !event) return;
      this._debugEventEndingId = String(endingId);
      this.show({
        ...event,
        ...ending,
        id: ending.id,
        blueprintScheduleId: event.id,
        blueprint: event.blueprint,
        dialogueTree: event.dialogueTree,
      });
    });
  }

  show(def) {
    const token = ++this._runToken;
    this.rootEl.innerHTML = `
      <div class="ending-gal-screen">
        <div class="ending-gal-scene">
          <div class="ending-gal-cg"></div>
          <div class="ending-gal-character ending-gal-player" data-ending-speaker="player"><img class="ending-gal-portrait" src="data/assets/player_portrait.png" alt="主控" draggable="false"></div>
          <div class="ending-gal-character ending-gal-npc" data-ending-speaker="binbin"></div>
        </div>
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
    this._eventOffs.forEach((off) => off());
    this._eventOffs = [];
    const cgEl = this.rootEl.querySelector(".ending-gal-cg");
    const playerEl = this.rootEl.querySelector('[data-ending-speaker="player"]');
    const npcEl = this.rootEl.querySelector('[data-ending-speaker="binbin"]');
    dataLoader.loadJSON("npcs.json").then((data) => {
      if (token !== this._runToken) return;
      const npc = (data.npcs || []).find((item) => item.id === "binbin");
      const endingPortrait = (npc?.endingPortraits || []).find(
        (item) => item.endingId === def.id && item.imageData,
      );
      const portrait = endingPortrait || (npc?.portraits || []).find((item) => item.imageData);
      if (portrait) {
        npcEl.innerHTML = `<img class="ending-gal-portrait" src="${portrait.imageData}" alt="彬彬" draggable="false">`;
      }
    }).catch(() => {});
    this._eventOffs.push(eventBus.on("cg:show", ({ imageData }) => {
      if (token !== this._runToken) return;
      if (imageData) cgEl.style.backgroundImage = `url("${imageData}")`;
    }));
    this._eventOffs.push(eventBus.on("cg:end", () => { cgEl.style.backgroundImage = ""; }));
    let pendingLines = [];
    let bypassContinueCapture = false;
    const continueCapture = (event) => {
      const button = event.target.closest(".dialogue-continue");
      if (!button || !optionsEl || !optionsEl.contains(button) || bypassContinueCapture) return;
      if (!pendingLines.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const nextLine = pendingLines.shift();
      showLine(nextLine);
    };
    const showLine = ({ speaker, label, text }) => {
      if (token !== this._runToken) return;
      logEl.replaceChildren();
      const line = document.createElement("p");
      line.className = `ending-dialogue-line ending-dialogue-${speaker || "npc"}`;
      const speakerEl = document.createElement("strong");
      speakerEl.textContent = `${label}：`;
      const textEl = document.createElement("span");
      textEl.textContent = text;
      line.append(speakerEl, textEl);
      logEl.appendChild(line);
      playerEl.classList.toggle("ending-gal-active", speaker === "player");
      npcEl.classList.toggle("ending-gal-active", speaker !== "player" && speaker !== "narrator");
    };
    const optionsEl = this.rootEl.querySelector(".ending-schedule-options");
    optionsEl.addEventListener("click", continueCapture, true);
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
    const statusEl = this.rootEl.querySelector(".ending-schedule-status");
    const appendLine = (speaker, label, text) => {
      if (token !== this._runToken) return;
      if (pendingLines.length === 0) logEl.replaceChildren();
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
        const line = { speaker: lineSpeaker || "npc", label: lineLabel, text: lineText };
        if (logEl.childElementCount === 0 && pendingLines.length === 0) showLine(line);
        else pendingLines.push(line);
      });
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
    this._eventOffs.forEach((off) => off());
    this._eventOffs = [];
    this.rootEl.classList.add("hidden");
    this.rootEl.replaceChildren();
  }
}
