import { eventBus } from "../core/EventBus.js";
import { dataLoader } from "../core/DataLoader.js";
import { gameState } from "../core/GameState.js";
import { timeService } from "../core/TimeService.js";
import { scheduleData } from "../core/ScheduleData.js";
import { keywordManager } from "../core/KeywordManager.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { itemManager } from "../core/ItemManager.js";
import { itemPlacementManager } from "../core/ItemPlacementManager.js";
import { saveManager } from "../core/SaveManager.js";
import { createScheduleRunner } from "../core/ScheduleRunner.js";
import { realtimeQueue } from "../core/ScheduleQueue.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { launchChatGTPApp } from "../apps/ChatGTPApp.js";

const roommateImage = (npcId) => ({
  ajie: "data/assets/char_ajie_01.png",
  awei: "data/assets/char_awei_01.png",
  binbin: "data/assets/char_binbin_01.png",
}[npcId] || "");

const dialogueKeywordIds = (tree) => {
  if (typeof keywordManager.idsFromDialogueTree === "function") return keywordManager.idsFromDialogueTree(tree);
  const ids = [];
  Object.values(tree?.nodes || {}).forEach((node) => String(node?.text || "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => { if (!ids.includes(id)) ids.push(id); return _; }));
  return ids;
};

const MOVE_STEP = 18;
const ROOM = { minX: 20, maxX: 460, minY: 195, maxY: 285 };

/** Full-screen off-duty room: movement, NPC interaction, bed, and player menu. */
export default class DormMode {
  constructor(root, { workShell, launchWorkApp }) {
    this.root = root;
    this.workShell = workShell;
    this.launchWorkApp = launchWorkApp;
    this.scenes = null;
    this.entry = null;
    this.playerPos = { x: 240, y: 260 };
    this.facing = 1;
    this._transitioning = false;
    this._build();
    eventBus.on("daynight:changed", (detail) => this._onStateChanged(detail));
    eventBus.on("time:changed", () => this._renderClock());
    eventBus.on("gamestate:changed", () => this._renderClock());
  }

  async init() {
    this.scenes = await dataLoader.loadJSON("monitor_scenes.json");
    await this._renderScene();
    this._syncVisibility(false);
  }

  _build() {
    this.root.className = "dorm-mode-overlay hidden";
    this.root.innerHTML = `
      <div class="dorm-room-frame">
        <div class="dorm-room-header"><strong>宿舍</strong><span class="dorm-mode-tip">点击场景移动 · 点击人物交互</span></div>
        <div class="dorm-viewport panel-inset">
          <img class="dorm-scene-bg" alt="宿舍" />
          <div class="dorm-wall-clock"><span class="dorm-wall-clock-label">GAME TIME</span><strong></strong></div>
          <div class="dorm-marker-layer"></div>
          <img class="dorm-player" alt="主角" width="30" height="110" />
        </div>
        <div class="dorm-interaction panel-inset"><p>点击主角查看状态、物品与保存菜单。</p></div>
        <div class="dorm-bed-confirm hidden" role="dialog" aria-modal="true">
          <div class="dorm-bed-confirm-box panel-inset">
            <strong class="dorm-bed-confirm-title"></strong>
            <p class="dorm-bed-confirm-message"></p>
            <div class="dorm-bed-confirm-actions">
              <button type="button" class="win95-btn bevel-out dorm-bed-confirm-ok">确认</button>
              <button type="button" class="win95-btn bevel-out dorm-bed-confirm-cancel">取消</button>
            </div>
          </div>
        </div>
      </div>`;
    this.viewport = this.root.querySelector(".dorm-viewport");
    this.bg = this.root.querySelector(".dorm-scene-bg");
    this.clock = this.root.querySelector(".dorm-wall-clock strong");
    this.markers = this.root.querySelector(".dorm-marker-layer");
    this.player = this.root.querySelector(".dorm-player");
    this.interaction = this.root.querySelector(".dorm-interaction");
    this.confirmPanel = this.root.querySelector(".dorm-bed-confirm");
    this.confirmTitle = this.root.querySelector(".dorm-bed-confirm-title");
    this.confirmMessage = this.root.querySelector(".dorm-bed-confirm-message");
    this.computerClose = document.getElementById("computer-close-button");
    this.computerClose.addEventListener("click", () => this._closeComputer());
    this.confirmPanel.querySelector(".dorm-bed-confirm-cancel").addEventListener("click", () => {
      this.confirmPanel.classList.add("hidden");
    });
    this.player.src = "data/assets/char01_01_stage.png";
    this.player.addEventListener("click", (event) => {
      event.stopPropagation();
      this._showPlayerMenu();
    });
    this.viewport.addEventListener("click", (event) => {
      const rect = this.viewport.getBoundingClientRect();
      this._moveTo(event.clientX - rect.left, event.clientY - rect.top);
    });
  }

  _clockMinutes() {
    const start = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    return gameState.clockMinutes;
  }

  _renderClock() {
    const minutes = this._clockMinutes();
    this.clock.textContent = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  _moveTo(x, y) {
    const previousX = this.playerPos.x;
    this.playerPos = {
      x: Math.max(ROOM.minX, Math.min(ROOM.maxX, x)),
      y: Math.max(ROOM.minY, Math.min(ROOM.maxY, y)),
    };
    this.facing = x >= previousX ? 1 : -1;
    this.player.style.left = `${this.playerPos.x}px`;
    this.player.style.top = `${this.playerPos.y}px`;
    this.player.style.transform = `translate(-50%, -100%) scaleX(${this.facing})`;
  }

  async _renderScene() {
    if (!this.scenes) return;
    const scene = this.scenes.night;
    this.bg.src = scene.backgroundAsset;
    this._moveTo(this.playerPos.x, this.playerPos.y);
    this._renderClock();
    this.markers.innerHTML = "";
    this._renderItemPlacements(scene);
    const listKey = gameState.phase === "day" ? "patients" : "contacts";
    this.entry = await scheduleData.load(gameState.day, gameState.phase);
    const actors = this.entry?.[listKey] || [];
    const slots = scene.actorSlots || [];
    const keywordDefs = {};
    actors.forEach((actor) => Object.assign(keywordDefs, keywordManager.definitionsWithSource(dialogueKeywordIds(actor.dialogueTree), `宿舍-${actor.name}`)));
    actors.slice(0, slots.length).forEach((actor, index) => {
      const npcId = actor.npcId || actor.id;
      const slot = slots[index];
      const image = roommateImage(npcId);
      const marker = image ? document.createElement("img") : document.createElement("button");
      if (!image) marker.type = "button";
      marker.className = `${image ? "dorm-npc-image" : "win95-btn bevel-out dorm-npc-marker"}${npcStateManager.isOffline(npcId) ? " offline" : ""}`;
      marker.style.left = `${slot.x}px`;
      marker.style.top = `${slot.y}px`;
      marker.title = `${actor.name}${npcStateManager.isOffline(npcId) ? "（暂时离线）" : ""}`;
      marker.setAttribute("aria-label", marker.title);
      if (image) {
        marker.src = image;
        marker.alt = actor.name;
        marker.setAttribute("role", "button");
        marker.tabIndex = 0;
      } else {
        marker.textContent = `${actor.avatar || "🙂"} ${actor.name}`;
      }
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this._showDialogue(actor, keywordDefs);
      });
      if (image) marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this._showDialogue(actor, keywordDefs);
        }
      });
      this.markers.appendChild(marker);
    });
    const bed = document.createElement("button");
    bed.type = "button";
    bed.className = "win95-btn bevel-out dorm-bed-marker";
    bed.textContent = "🛏️ 床";
    bed.title = "睡觉 / 去上班";
    bed.addEventListener("click", (event) => {
      event.stopPropagation();
      this._bedAction();
    });
    this.markers.appendChild(bed);

    const phone = document.createElement("button");
    phone.type = "button";
    phone.className = "win95-btn bevel-out dorm-phone-marker";
    phone.textContent = "📱 手机";
    phone.title = "打开 ChatGTP";
    phone.addEventListener("click", (event) => {
      event.stopPropagation();
      launchChatGTPApp({ container: this.interaction }).catch((err) => this._message(`ChatGTP 无法打开：${err.message}`));
    });
    this.markers.appendChild(phone);

    const clueWall = document.createElement("button");
    clueWall.type = "button";
    clueWall.className = "win95-btn bevel-out dorm-clue-wall-marker";
    clueWall.textContent = "🧵 线索墙";
    clueWall.title = "查看线索之间的关系";
    clueWall.addEventListener("click", (event) => {
      event.stopPropagation();
      this._showClueWall();
    });
    this.markers.appendChild(clueWall);

    const computer = document.createElement("button");
    computer.type = "button";
    computer.className = "win95-btn bevel-out dorm-computer-marker";
    computer.textContent = "🖥️ 电脑";
    computer.title = "打开电脑屏幕";
    computer.addEventListener("click", (event) => {
      event.stopPropagation();
      this._openComputer();
    });
    this.markers.appendChild(computer);
  }

  _renderItemPlacements(scene) {
    itemPlacementManager.visibleFor("dorm").forEach((placement) => {
      const hotspot = placement.hotspot || {};
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "win95-btn bevel-out dorm-item-placement-marker";
      marker.style.left = `${hotspot.x}px`;
      marker.style.top = `${hotspot.y}px`;
      marker.textContent = hotspot.icon || "❔";
      marker.title = hotspot.label || itemManager.getDef(placement.itemId)?.name || placement.itemId;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this._inspectPlacedItem(placement.id);
      });
      this.markers.appendChild(marker);
    });
  }

  _inspectPlacedItem(placementId) {
    const inspected = itemPlacementManager.inspect(placementId);
    if (!inspected.ok) {
      this._message(inspected.message);
      return;
    }
    this.interaction.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = itemManager.getDef(inspected.placement.itemId)?.name || "物品";
    this.interaction.appendChild(heading);
    const resultEl = document.createElement("div");
    this.interaction.appendChild(resultEl);
    renderInspectResult(inspected.result, resultEl);
    const takeButton = document.createElement("button");
    takeButton.className = "win95-btn bevel-out";
    takeButton.textContent = "拿起并放入物品栏";
    takeButton.addEventListener("click", () => {
      const result = itemPlacementManager.take(placementId);
      this._message(result.message, result.ok ? "success" : "");
      if (result.ok) {
        this._renderScene();
        this._showHeldPlacement(placementId);
      }
    });
    this.interaction.appendChild(takeButton);
  }

  _showHeldPlacement(placementId) {
    const placement = itemPlacementManager.get(placementId);
    if (!placement) return;
    const putBackButton = document.createElement("button");
    putBackButton.className = "win95-btn bevel-out";
    putBackButton.textContent = "放回书桌";
    putBackButton.addEventListener("click", () => {
      const result = itemPlacementManager.putBack(placementId);
      this._message(result.message, result.ok ? "success" : "");
      if (result.ok) this._renderScene();
    });
    this.interaction.appendChild(putBackButton);
  }

  _openComputer() {
    this.workShell.classList.add("computer-screen-active");
    this.root.classList.add("computer-open");
    this.computerClose.classList.remove("hidden");
  }

  _closeComputer() {
    this.workShell.classList.remove("computer-screen-active");
    this.root.classList.remove("computer-open");
    this.computerClose.classList.add("hidden");
  }

  _showClueWall() {
    const clues = keywordManager.all().filter((keyword) => keyword.category === "clue" || keyword.id === "old_key_clue");
    this.interaction.innerHTML = "<h3>线索墙</h3><p class=\"dorm-clue-wall-note\">红线表示目前已发现线索之间的关联。</p>";
    if (!clues.length) {
      this.interaction.insertAdjacentHTML("beforeend", "<p>还没有足够的线索。与 NPC 交互或调查物品来收集线索。</p>");
      return;
    }
    const width = 620;
    const height = Math.max(170, Math.ceil(clues.length / 3) * 82);
    const board = document.createElement("div");
    board.className = "dorm-clue-wall";
    board.style.setProperty("--clue-wall-height", `${height}px`);
    const positions = clues.map((_, index) => ({
      x: 55 + (index % 3) * 250,
      y: 35 + Math.floor(index / 3) * 82,
    }));
    const svg = `<svg class="dorm-clue-lines" viewBox="0 0 ${width} ${height}" aria-hidden="true">${this._clueConnections(clues, positions)}</svg>`;
    board.insertAdjacentHTML("beforeend", svg);
    clues.forEach((clue, index) => {
      const node = document.createElement("div");
      node.className = "dorm-clue-node";
      node.style.left = `${positions[index].x}px`;
      node.style.top = `${positions[index].y}px`;
      node.title = clue.content || clue.label || clue.id;
      node.textContent = clue.content || clue.label || clue.id;
      board.appendChild(node);
    });
    this.interaction.appendChild(board);
  }

  _clueConnections(clues, positions) {
    const index = new Map(clues.map((clue, i) => [clue.id, i]));
    const pairs = [];
    const add = (a, b) => {
      if (index.has(a) && index.has(b)) pairs.push([index.get(a), index.get(b)]);
    };
    add("old_key_clue", "basement_secret");
    add("night_shift_rumor", "night_shift_rumor_detail");
    add("night_shift_rumor", "night_shift_rumor_echo");
    add("night_shift_injury", "emergency_bruise");
    for (let i = 1; i < clues.length; i += 1) {
      if (!pairs.some(([a, b]) => a === i || b === i)) pairs.push([i - 1, i]);
    }
    return pairs.map(([a, b]) => `<line x1="${positions[a].x}" y1="${positions[a].y}" x2="${positions[b].x}" y2="${positions[b].y}" />`).join("");
  }

  _showPlayerMenu() {
    const state = gameState.snapshot();
    const items = itemManager.all();
    this.interaction.innerHTML = `<h3>主角菜单</h3><p>第 ${state.day} 天 · ${dayNightSystem.isDaylight() ? "白天" : "夜晚"} · ${this.clock.textContent}</p><p>精神 ${state.mental} · 体力 ${state.physical} · 精力 ${state.energy} · 饱腹 ${state.satiety}</p>`;
    const itemTitle = document.createElement("h4");
    itemTitle.textContent = "物品";
    this.interaction.appendChild(itemTitle);
    const list = document.createElement("ul");
    items.forEach(({ def, count }) => {
      const row = document.createElement("li");
      row.textContent = `${def.name} x${count}`;
      list.appendChild(row);
    });
    if (!items.length) list.innerHTML = "<li>（空）</li>";
    this.interaction.appendChild(list);
    const save = document.createElement("button");
    save.className = "win95-btn bevel-out";
    save.textContent = "保存游戏";
    save.addEventListener("click", () => {
      saveManager.save();
      this._message("游戏已保存到当前链接。", "success");
    });
    this.interaction.append(save);
  }

  _showDialogue(actor, keywordDefs) {
    this.interaction.innerHTML = `<h3>与 ${actor.name} 交互</h3>`;
    if (npcStateManager.isOffline(actor.id)) {
      this.interaction.innerHTML += "<p>（对方已经离线，无法交互。）</p>";
      return;
    }
    if (!dayNightSystem.areRoommatesAvailable()) {
      this.interaction.innerHTML += `<p>（${dayNightSystem.areRoommatesSleeping() ? "对方正在睡觉" : "对方正在上班"}，暂时无法交互。）</p>`;
      return;
    }
    const lines = document.createElement("div");
    const options = document.createElement("div");
    options.className = "dialogue-options";
    this.interaction.append(lines, options);
    if (!actor.blueprint) {
      lines.innerHTML = "<p class=\"dialogue-end\">（该内容尚未转换为日程蓝图。）</p>";
      return;
    }
    const instance = realtimeQueue.append([{ scheduleId: actor.id, payload: actor, status: "unresolved", transcript: [] }])[0];
    const runner = createScheduleRunner({
      definition: actor,
      instance,
      appendLine: (speaker, label, text) => {
        const line = document.createElement("p");
        line.innerHTML = `<strong>${label}:</strong> ${keywordManager.renderHighlightedText(text, keywordDefs)}`;
        lines.appendChild(line);
        keywordManager.bindHighlights(line, keywordDefs);
      },
      optionsEl: options,
      appId: "dorm",
      onCheckpoint: (next) => realtimeQueue.updateInstance(instance.instanceId, next),
      onComplete: () => realtimeQueue.complete(instance.instanceId),
    });
    runner.start();
  }

  _bedAction() {
    const minutes = this._clockMinutes();
    const inWork = minutes >= 8 * 60 && minutes < 16 * 60;
    this.confirmTitle.textContent = inWork ? "去上班确认" : "睡觉确认";
    this.confirmMessage.textContent = inWork
      ? "现在是工作时间，确定直接去上班吗？"
      : "确定睡觉直到次日 08:00 吗？";
    this.confirmPanel.classList.remove("hidden");
    const okButton = this.confirmPanel.querySelector(".dorm-bed-confirm-ok");
    const confirm = () => {
      this.confirmPanel.classList.add("hidden");
      if (inWork) this.launchWorkApp();
      else dayNightSystem.toggle();
    };
    okButton.onclick = confirm;
    okButton.focus();
  }

  _message(text, className = "") {
    this.interaction.textContent = text;
    if (className) this.interaction.classList.add(className);
  }

  _onStateChanged(detail = {}) {
    const changed = detail.phaseChanged !== false;
    if (changed) this._transition(gameState.location === "dorm");
    else this._syncVisibility(gameState.location === "dorm");
    if (gameState.location === "dorm") this._renderScene();
  }

  _syncVisibility(showDorm) {
    if (!showDorm) this._closeComputer();
    this.root.classList.toggle("hidden", !showDorm);
    this.workShell.classList.toggle("work-mode-active", !showDorm);
    this._renderClock();
  }

  _transition(showDorm) {
    if (this._transitioning) return;
    this._transitioning = true;
    this.root.classList.add("mode-transition", showDorm ? "opening-laptop" : "closing-laptop");
    window.setTimeout(() => {
      this._syncVisibility(showDorm);
      this.root.classList.remove("mode-transition", "opening-laptop", "closing-laptop");
      this._transitioning = false;
    }, 620);
  }
}
