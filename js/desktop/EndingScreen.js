import { endingManager } from "../core/EndingManager.js";
import { i18n } from "../core/I18n.js";
import { dataLoader } from "../core/DataLoader.js";
import { eventBus } from "../core/EventBus.js";
import { scheduleData } from "../core/ScheduleData.js";
import { mainQueue } from "../core/ScheduleQueue.js";
import { scheduleExecutionService } from "../core/ScheduleExecutionService.js";
import { displayReceiverManager } from "../core/DisplayReceiverManager.js";

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
      // Pure special-event debug playback: show the event blueprint from its
      // real startNodeId; no ending card is appended when it completes.
      if (endingId == null && ending == null && event?.blueprint) {
        this._debugEventEndingId = "__none__";
        this.show({ ...event, id: event.id, blueprintScheduleId: event.id, debugEventOnly: true });
        return;
      }
      if (!endingId || !ending) return;
      // event === null: mechanism-triggered ending with no source special event.
      // Play the ending's own blueprint from its real startNodeId instead.
      const eventDef = event || null;
      const ownBlueprint = ending.blueprint || ending.dialogueTree || null;
      if (!eventDef && !ownBlueprint) return;
      this._debugEventEndingId = String(endingId);
      this.show(eventDef
        ? {
          ...eventDef,
          ...ending,
          id: ending.id,
          blueprintScheduleId: eventDef.id,
          blueprint: eventDef.blueprint,
          dialogueTree: eventDef.dialogueTree,
        }
        : { ...ending, id: ending.id, blueprintScheduleId: ending.id });
    });
  }

  show(def) {
    const token = ++this._runToken;
    this.rootEl.innerHTML = `
      <div class="ending-gal-screen">
        <div class="ending-gal-scene">
          <div class="ending-gal-cg"></div>
          <div class="ending-gal-character ending-gal-player" data-ending-speaker="player"></div>
          <div class="ending-gal-character ending-gal-npc" data-ending-speaker="binbin"></div>
        </div>
        <div class="ending-screen-panel">
          <h2 class="ending-screen-title">${def.debugEventOnly ? (def.name || def.id || "") : (def.title || "")}</h2>
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
    // Load every character's portraits once; the stage shows the current speaker's
    // portrait and hides whoever is not talking. The player entry (id "player")
    // is editable in the same character list as every NPC.
    let portraitsByNpc = {};
    dataLoader.loadJSON("npcs.json").then((data) => {
      if (token !== this._runToken) return;
      for (const npc of (data.npcs || [])) {
        const endingPortrait = (npc.endingPortraits || []).find(
          (item) => item.endingId === def.id && item.imageData,
        );
        const portrait = endingPortrait || (npc.portraits || []).find((item) => item.imageData);
        if (portrait) portraitsByNpc[npc.id] = portrait.imageData;
      }
      // Stage always has the protagonist on the left, from the editable entry
      // when available, else the static asset.
      if (!portraitsByNpc.player) portraitsByNpc.player = "data/assets/player_portrait.png";
    }).catch(() => { portraitsByNpc.player = "data/assets/player_portrait.png"; });
    // Map every speaker label the data may use to a stable character id.
    const speakerNpcIds = { 主控: "player", player: "player", 彬彬: "binbin", 阿杰: "ajie", 阿伟: "awei", binbin: "binbin", ajie: "ajie", awei: "awei", 克苏鲁: "new_npc_4", 大衮: "new_npc_5", 海德拉: "new_npc_6" };
    const stageElFor = (npcId) => (npcId === "player" ? playerEl : npcEl);
    const setNpcStage = (speaker) => {
      const npcId = speakerNpcIds[speaker];
      const imageData = npcId ? portraitsByNpc[npcId] : null;
      const stageEl = npcId ? stageElFor(npcId) : npcEl;
      if (imageData && npcId) {
        if (stageEl.dataset.npcId !== npcId) {
          stageEl.dataset.npcId = npcId;
          stageEl.innerHTML = `<img class="ending-gal-portrait" src="${imageData}" alt="${speaker}" draggable="false">`;
        }
        stageEl.classList.remove("hidden");
        stageEl.style.opacity = "1";
      } else if (npcId) {
        stageEl.classList.add("hidden");
        stageEl.replaceChildren();
        delete stageEl.dataset.npcId;
      }
    };
    const setStage = (speaker) => {
      const npcId = speakerNpcIds[speaker];
      if (npcId) {
        setNpcStage(speaker);
        // Whoever is not talking leaves the stage entirely.
        const otherEl = npcId === "player" ? npcEl : playerEl;
        otherEl.classList.add("hidden");
        otherEl.replaceChildren();
        delete otherEl.dataset.npcId;
      }
    };
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
      // Only the current speaker stands on stage, at full opacity and clarity.
      setStage(speaker);
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
      if (!def.debugEventOnly) finish();
      return;
    }

    const logEl = this.rootEl.querySelector(".ending-schedule-log");
    const appendLine = (speaker, label, text) => {
      if (token !== this._runToken) return;
      if (pendingLines.length === 0) logEl.replaceChildren();
      const speakerLabels = { player: "主控", awei: "阿伟", ajie: "阿杰", binbin: "彬彬", narrator: "旁白", npc: "" };
      const speakerIds = { 主控: "player", 彬彬: "binbin", 旁白: "narrator" };
      const fallbackSpeaker = speakerLabels[speaker] || label || speaker || "";
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
      if (!ok || !instance) throw new Error(`无法创建结局活动：${reason || "unknown"}`);
      instance.currentNodeId = playbackDefinition.blueprint?.startNodeId
        || playbackDefinition.startNodeId
        || null;
      instance.executedNodeIds = [];
      instance.transcript = [];
      const offDisplay = displayReceiverManager.register("ending-screen", ({ speaker, label, text }) => appendLine(speaker, label, text));
      scheduleExecutionService.run({
        queue: mainQueue,
        definition: playbackDefinition,
        instance,
        appendLine,
        optionsEl,
        appId: "ending",
        onComplete: (next) => {
          offDisplay();
          mainQueue.complete(next.instanceId);
          if (!def.debugEventOnly) finish();
          else this.hide();
        },
      });
    }).catch((error) => {
      if (token !== this._runToken) return;
      console.error("[EndingScreen] Failed to execute ending blueprint:", error);
      if (!def.debugEventOnly) finish();
      else this.hide();
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
