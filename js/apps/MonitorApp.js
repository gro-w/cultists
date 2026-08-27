import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { itemManager } from "../core/ItemManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";
import { scheduleData } from "../core/ScheduleData.js";
import { createDialogueRunner } from "../core/DialogueRunner.js";
import { npcStateManager } from "../core/NpcStateManager.js";

import { formatInspectResult } from "../core/InspectFormat.js";

const MOVE_STEP = 18; // px per arrow-key press
const CHARACTER_SPRITE = "data/assets/char01_01_stage.png";

/**
 * MonitorApp - a top-down "surveillance camera" view of the protagonist.
 * The player token can be walked around a scene (click to move, or arrow
 * keys), talk to whichever NPCs the current day/phase schedule places in
 * the room (same `dialogueTree` data HISApp/SocialApp use, walked via the
 * shared `createDialogueRunner`), and inspect/use items that are visible
 * in the room (same ItemManager definitions the Status app's inventory
 * tab uses - including repeatable dice-check inspections, see
 * `formatInspectResult`/ItemManager.inspect()).
 *
 * The scene background + NPC/item marker layout is entirely data-driven via
 * `data/monitor_scenes.json` ({ day: {...}, night: {...} }), so new rooms or
 * hotspot positions can be tuned without touching this file. Content (who
 * appears, what they say, which items exist) still comes from the existing
 * `dayXXa.json`/`dayXXb.json` schedule + `items.json` - Monitor is just
 * another *view* onto that same data, not a new content model.
 */
export async function launchMonitorApp() {
  await scheduleData.init();
  const scenes = await dataLoader.loadJSON("monitor_scenes.json");

  const root = document.createElement("div");
  root.className = "app-monitor";
  root.innerHTML = `
    <h4 class="monitor-title"></h4>

    <div class="monitor-viewport-wrap panel-inset">
      <div class="monitor-viewport" tabindex="0">
        <img class="monitor-scene-bg" alt="" />
        <div class="monitor-marker-layer"></div>
        <img class="monitor-player" alt="主角" width="30" height="110" />
      </div>
    </div>
    <div class="monitor-interaction panel-inset"></div>
  `;

  const titleEl = root.querySelector(".monitor-title");

  const viewportEl = root.querySelector(".monitor-viewport");
  const bgEl = root.querySelector(".monitor-scene-bg");
  const markerLayerEl = root.querySelector(".monitor-marker-layer");
  const playerEl = root.querySelector(".monitor-player");
  const interactionEl = root.querySelector(".monitor-interaction");

  playerEl.src = CHARACTER_SPRITE;

  let currentScene = null;
  let playerPos = { x: 240, y: 260 };
  let facing = 1; // 1 = facing right, -1 = facing left

  // Per-actor "how far into the conversation" cursor, local to this app
  // instance (not persisted via DialogueProgress/SaveManager - reopening
  // Monitor or changing phase simply restarts that actor's conversation,
  // same as HIS/Social do for an actor they haven't met yet).
  const dialogueNodeByActor = new Map();

  function sceneFor(phase) {
    return phase === "night" ? scenes.night : scenes.day;
  }

  function clampToBounds(pos, bounds) {
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, pos.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, pos.y)),
    };
  }

  function placePlayer(animate) {
    playerEl.style.transition = animate ? "left 0.35s linear, top 0.35s linear" : "none";
    playerEl.style.left = `${playerPos.x}px`;
    playerEl.style.top = `${playerPos.y}px`;
    playerEl.style.transform = `translate(-50%, -100%) scaleX(${facing})`;
  }

  function movePlayerTo(x, y) {
    if (!currentScene) return;
    const next = clampToBounds({ x, y }, currentScene.bounds);
    if (Math.abs(next.x - playerPos.x) > 1) facing = next.x >= playerPos.x ? 1 : -1;
    playerPos = next;
    placePlayer(true);
  }

  function showHint(message) {
    interactionEl.innerHTML = `<p class="monitor-hint">${message}</p>`;
  }


  /** Render the shared dialogueTree conversation UI for one actor (patient/contact). */
  function renderActorInteraction(actor, keywordDefs) {
    interactionEl.innerHTML = `<h4>与 ${actor.name} 对话</h4>`;

    if (npcStateManager.isOffline(actor.id)) {
      interactionEl.innerHTML += '<p class="dialogue-end">（对方情绪崩溃后已经离开，暂时无法互动。）</p>';
      return;
    }
    if (npcStateManager.isDistressed(actor.id)) {
      const warn = document.createElement("p");
      warn.className = "his-schedule-note npc-distress-warning";
      warn.textContent = "⚠️ 对方情绪明显不稳定。";
      interactionEl.appendChild(warn);
    }

    const linesEl = document.createElement("div");
    linesEl.className = "dialogue-lines monitor-dialogue-lines";
    const optionsEl = document.createElement("div");
    optionsEl.className = "dialogue-options";
    interactionEl.appendChild(linesEl);
    interactionEl.appendChild(optionsEl);

    function appendLine(speaker, label, text) {
      const p = document.createElement("p");
      p.className = `dialogue-line speaker-${speaker}`;
      p.innerHTML = `<strong>${label}:</strong> ${keywordManager.renderHighlightedText(text, keywordDefs)}`;
      linesEl.appendChild(p);
      keywordManager.bindHighlights(p, keywordDefs);
      interactionEl.scrollTop = interactionEl.scrollHeight;
    }

    const runner = createDialogueRunner({
      actor,
      appendLine,
      optionsEl,
      optionBtnClass: "win95-btn bevel-out dialogue-option-btn",
      appId: "monitor",
      onNodeShown: (nodeId) => dialogueNodeByActor.set(actor.id, nodeId),
      emptyMessage: "（暂无对话内容）",
    });

    runner.showNode(dialogueNodeByActor.get(actor.id) || (actor.dialogueTree && actor.dialogueTree.start));
  }

  /** Render the inspect/use UI for an item hotspot, mirroring StatusApp's inventory actions. */
  function renderItemInteraction(itemId) {
    const def = itemManager.getDef(itemId);
    if (!def) return;
    interactionEl.innerHTML = `<h4>调查: ${def.name}</h4>`;
    const text = document.createElement("p");
    text.className = "monitor-item-text";
    interactionEl.appendChild(text);

    function doInspect() {
      const result = itemManager.inspect(itemId);
      text.textContent = formatInspectResult(result);
    }
    doInspect();

    const inspectAgainBtn = document.createElement("button");
    inspectAgainBtn.className = "win95-btn bevel-out";
    inspectAgainBtn.textContent = "再次调查";
    inspectAgainBtn.addEventListener("click", doInspect);
    interactionEl.appendChild(inspectAgainBtn);

    if (def.usable) {
      const useBtn = document.createElement("button");
      useBtn.className = "win95-btn bevel-out";
      useBtn.textContent = "使用";
      useBtn.addEventListener("click", () => {
        const result = itemManager.use(itemId);
        text.textContent = result.message;
        renderItemHotspots(); // held items may have changed (consumed / swapped)
      });
      interactionEl.appendChild(useBtn);
    }
  }

  function renderActorMarkers(entry, keywordDefs, listKey) {
    const actors = entry[listKey] || [];
    const slots = currentScene.actorSlots || [];
    actors.slice(0, slots.length).forEach((actor, idx) => {
      const slot = slots[idx];
      const offline = npcStateManager.isOffline(actor.id);
      const distressed = !offline && npcStateManager.isDistressed(actor.id);
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `win95-btn bevel-out monitor-npc-marker${offline ? " offline" : ""}${
        distressed ? " distressed" : ""
      }`;
      marker.style.left = `${slot.x}px`;
      marker.style.top = `${slot.y}px`;
      marker.textContent = `${actor.avatar || "🧑‍⚕️"} ${actor.name}${
        offline ? " 🚫" : distressed ? " ⚠️" : ""
      }`;
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        renderActorInteraction(actor, keywordDefs);
      });
      markerLayerEl.appendChild(marker);
    });
    if (actors.length > slots.length) {
      console.warn(
        `[MonitorApp] ${actors.length} actor(s) but only ${slots.length} scene slot(s) configured; extras are hidden.`
      );
    }
  }

  function renderItemHotspots() {
    markerLayerEl.querySelectorAll(".monitor-item-marker").forEach((el) => el.remove());
    if (!currentScene) return;
    (currentScene.itemHotspots || []).forEach((hotspot) => {
      if (!itemManager.has(hotspot.itemId, 1)) return; // only show items actually in the room/held
      const def = itemManager.getDef(hotspot.itemId);
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "win95-btn bevel-out monitor-item-marker";
      marker.style.left = `${hotspot.x}px`;
      marker.style.top = `${hotspot.y}px`;
      marker.textContent = hotspot.icon || "❔";
      marker.title = def ? def.name : hotspot.itemId;
      marker.addEventListener("click", (e) => {
        e.stopPropagation();
        renderItemInteraction(hotspot.itemId);
      });
      markerLayerEl.appendChild(marker);
    });
  }

  async function renderScene() {
    const phase = gameState.phase;
    currentScene = sceneFor(phase);
    bgEl.src = currentScene.backgroundAsset;
    bgEl.alt = currentScene.backgroundLabel || "";
    titleEl.textContent = `${currentScene.backgroundLabel || "监控画面"}（第${gameState.day}天 · ${
      phase === "day" ? "白天" : "夜晚"
    }）`;
    updateBudgetHint();

    playerPos = clampToBounds(currentScene.playerStart || playerPos, currentScene.bounds);
    placePlayer(false);

    markerLayerEl.innerHTML = "";
    const entry = await scheduleData.load(gameState.day, phase);
    const listKey = phase === "day" ? "patients" : "contacts";
    if (!entry || (entry[listKey] || []).length === 0) {
      showHint("（当前场景暂无人员出现）点击场景可以移动主角。");
    } else {
      const keywordDefs = {};
      (entry[listKey] || []).forEach((actor) => {
        Object.assign(keywordDefs, keywordManager.definitionsWithSource(actor.keywordIds, `监控-${actor.name}`));
      });
      renderActorMarkers(entry, keywordDefs, listKey);
      showHint("点击场景移动主角，点击 NPC 或物品图标进行互动。");
    }
    renderItemHotspots();
  }

  viewportEl.addEventListener("click", (e) => {
    const rect = viewportEl.getBoundingClientRect();
    movePlayerTo(e.clientX - rect.left, e.clientY - rect.top);
  });

  viewportEl.addEventListener("keydown", (e) => {
    if (!currentScene) return;
    switch (e.key) {
      case "ArrowLeft":
        movePlayerTo(playerPos.x - MOVE_STEP, playerPos.y);
        break;
      case "ArrowRight":
        movePlayerTo(playerPos.x + MOVE_STEP, playerPos.y);
        break;
      case "ArrowUp":
        movePlayerTo(playerPos.x, playerPos.y - MOVE_STEP);
        break;
      case "ArrowDown":
        movePlayerTo(playerPos.x, playerPos.y + MOVE_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  const offDayNight = eventBus.on("daynight:changed", renderScene);
  const offItems = eventBus.on("items:changed", () => renderItemHotspots());

  const offNpcState = eventBus.on("npc:offline", renderScene);

  await renderScene();

  return windowManager.createWindow({
    appId: "monitor",
    title: i18n.t("apps.monitor", "监控画面"),
    icon: "🖥️",
    width: 520,
    height: 580,
    content: root,
    onClose: () => {
      offDayNight();
      offItems();

      offNpcState();
    },
  });
}
