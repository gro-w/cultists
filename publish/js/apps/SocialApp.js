import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { keywordManager } from "../core/KeywordManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";
import { dialogueProgress } from "../core/DialogueProgress.js";
import { scheduleData } from "../core/ScheduleData.js";
import { createDialogueRunner } from "../core/DialogueRunner.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { dayNightSystem } from "../core/DayNightSystem.js";


/**
 * SocialApp - Social media style chat client.
 * Always accessible, but the contact/conversation content varies by the
 * current in-game day/phase (data-driven via `data/dayXXa.json` /
 * `data/dayXXb.json`, resolved through ScheduleData).
 *
 * Dialogue tree walking (dice-check options, npcSanChange, dialogue:turn
 * budget accounting) is shared with HISApp/MonitorApp via
 * `createDialogueRunner` (see DialogueRunner.js). A contact whose own SAN
 * (NpcStateManager) has dropped to "offline" goes silent for the rest of
 * the game.
 */
export async function launchSocialApp() {
  await scheduleData.init();

  const root = document.createElement("div");
  root.className = "app-social";
  root.innerHTML = `
    <div class="social-layout">
      <div class="social-contact-list panel-inset"></div>
      <div class="social-chat panel-inset"></div>
    </div>
  `;

  const contactListEl = root.querySelector(".social-contact-list");
  const chatEl = root.querySelector(".social-chat");

  function registerKeywords(entry) {
    const keywordDefs = {};
    (entry.contacts || []).forEach((c) => {
      Object.assign(keywordDefs, keywordManager.definitionsWithSource(c.keywordIds, `室友-${c.name}`));
    });
    return keywordDefs;
  }


  function renderContacts(entry, keywordDefs) {
    contactListEl.innerHTML = `<h4>联系人（第${gameState.day}天 · ${
      dayNightSystem.isDaylight() ? "白天" : "夜晚"
    }）</h4>`;
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "his-schedule-note";
      note.textContent = entry.note;
      contactListEl.appendChild(note);
    }

    if (!entry.contacts || entry.contacts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "his-empty";
      empty.textContent = "暂无联系人在线。";
      contactListEl.appendChild(empty);
      chatEl.innerHTML = '<h4>聊天</h4><p class="dialogue-end">（无联系人）</p>';
      return;
    }
    entry.contacts.forEach((contact) => {
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out social-contact-btn";
      const offline = npcStateManager.isOffline(contact.id);
      const unavailable = !dayNightSystem.areRoommatesAvailable();
      const distressed = !offline && npcStateManager.isDistressed(contact.id);
      btn.textContent = `${contact.avatar || "🙂"} ${contact.name}${
        offline ? " 🚫" : unavailable ? " 💤" : distressed ? " ⚠️" : ""
      }`;
      btn.disabled = offline || unavailable;
      btn.addEventListener("click", () => renderChat(contact, keywordDefs));
      contactListEl.appendChild(btn);
    });

    const resumeId = dialogueProgress.get("social").actorId;
    const resumeContact = entry.contacts.find((c) => c.id === resumeId);
    renderChat(resumeContact || entry.contacts[0], keywordDefs);
  }

  function renderChat(contact, keywordDefs) {
    chatEl.innerHTML = `<h4>与 ${contact.name} 的聊天</h4>`;

    if (npcStateManager.isOffline(contact.id)) {
      chatEl.innerHTML += '<p class="dialogue-end">（对方已经很久没有上线了，消息始终没有回音。）</p>';
      return;
    }
    if (!dayNightSystem.areRoommatesAvailable()) {
      chatEl.innerHTML += `<p class="dialogue-end">（${dayNightSystem.areRoommatesSleeping() ? "对方正在睡觉" : "对方正在上班"}，暂时无法聊天。）</p>`;
      return;
    }
    if (npcStateManager.isDistressed(contact.id)) {
      const warn = document.createElement("p");
      warn.className = "his-schedule-note npc-distress-warning";
      warn.textContent = "⚠️ 对方的语气最近变得异常低落，回复也断断续续。";
      chatEl.appendChild(warn);
    }

    const bubblesEl = document.createElement("div");
    bubblesEl.className = "chat-bubbles";
    const optionsEl = document.createElement("div");
    optionsEl.className = "dialogue-options";
    chatEl.appendChild(bubblesEl);
    chatEl.appendChild(optionsEl);

    function appendBubble(from, text) {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble bubble-${from}`;
      bubble.innerHTML = keywordManager.renderHighlightedText(text, keywordDefs);
      bubblesEl.appendChild(bubble);
      keywordManager.bindHighlights(bubble, keywordDefs);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    const runner = createDialogueRunner({
      actor: contact,
      appendLine: (speaker, label, text) => appendBubble(speaker === "npc" ? "npc" : "me", text),
      optionsEl,
      optionBtnClass: "win95-btn bevel-out dialogue-option-btn",
      appId: "social",
      onNodeShown: (nodeId) => dialogueProgress.set("social", contact.id, nodeId),
    });

    const resumeNodeId =
      dialogueProgress.get("social").actorId === contact.id
        ? dialogueProgress.get("social").nodeId
        : null;
    runner.showNode(resumeNodeId || (contact.dialogueTree && contact.dialogueTree.start));
  }

  async function renderCurrentEntry() {
    const entry = await scheduleData.load(gameState.day, gameState.phase);
    if (!entry) {
      contactListEl.innerHTML = '<h4>联系人</h4><p class="his-empty">（今日暂无安排）</p>';
      chatEl.innerHTML = "";
      return;
    }
    const keywordDefs = registerKeywords(entry);
    renderContacts(entry, keywordDefs);
  }

  const offDayNight = eventBus.on("daynight:changed", renderCurrentEntry);

  const offNpcState = eventBus.on("npc:offline", renderCurrentEntry);

  await renderCurrentEntry();

  return windowManager.createWindow({
    appId: "social",
    title: i18n.t("apps.social", "夜聊 Messenger"),
    icon: "💬",
    width: 560,
    height: 420,
    content: root,
    onClose: () => {
      offDayNight();

      offNpcState();
    },
  });
}
