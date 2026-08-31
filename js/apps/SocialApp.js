import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { keywordManager } from "../core/KeywordManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";

import { activityData } from "../core/ActivityData.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { socialQueue } from "../core/ActivityQueue.js";

const dialogueKeywordIds = (tree) => {
  if (typeof keywordManager.idsFromDialogueTree === "function") return keywordManager.idsFromDialogueTree(tree);
  const ids = [];
  Object.values(tree?.nodes || {}).forEach((node) => String(node?.text || "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => { if (!ids.includes(id)) ids.push(id); return _; }));
  return ids;
};


/**
 * SocialApp - Social media style chat client.
 * Always accessible, but the contact/conversation content varies by the
 * current in-game day/phase (data-driven via `data/dayXXa.json` /
 * `data/dayXXb.json`, resolved through ActivityData).
 *
 * Dialogue tree walking is shared with HISApp via the activity
 * runner. A contact whose own SAN
 * (NpcStateManager) has dropped to "offline" goes silent for the rest of
 * the game.
 */
export async function launchSocialApp() {
  await activityData.init();

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
      Object.assign(keywordDefs, keywordManager.definitionsWithSource(dialogueKeywordIds(c.dialogueTree), `室友-${c.name}`));
    });
    return keywordDefs;
  }


  function renderContacts(entry, keywordDefs) {
    contactListEl.innerHTML = `<h4>联系人（第${gameState.day}天 · ${
      dayNightSystem.isDaylight() ? "白天" : "夜晚"
    }）</h4>`;
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "his-activity-note";
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
    let groupKey = "";
    entry.contacts.forEach((contact) => {
      const nextGroupKey = `${contact.receivedDay}:${contact.receivedTime}`;
      if (nextGroupKey !== groupKey) {
        groupKey = nextGroupKey;
        const group = document.createElement("h5");
        group.className = "activity-group-heading";
        group.textContent = `第${contact.receivedDay}天 · ${contact.receivedTime === 480 ? "白班" : "夜班"} · ${String(Math.floor(contact.receivedTime / 60)).padStart(2, "0")}:${String(contact.receivedTime % 60).padStart(2, "0")}`;
        contactListEl.appendChild(group);
      }
      const npcId = contact.npcId || contact.id;
      const offline = npcStateManager.isOffline(npcId);
      const sleeping = dayNightSystem.areRoommatesSleeping();
      const distressed = !offline && npcStateManager.isDistressed(npcId);
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out social-contact-btn";
      btn.textContent = `${contact.name}${contact.queueStatus === "resolved" ? " ✓" : ""}${offline ? " 🚫" : sleeping ? " 💤" : distressed ? " ⚠️" : ""}`;
      btn.disabled = (offline || sleeping) && contact.queueStatus !== "resolved";
      btn.addEventListener("click", () => renderChat(contact, keywordDefs));
      contactListEl.appendChild(btn);
    });

    const currentContact = entry.contacts.find((c) => c.queueStatus !== "resolved") || entry.contacts[0];
    renderChat(currentContact, keywordDefs);
  }

  function renderChat(contact, keywordDefs) {
    const npcId = contact.npcId || contact.id;
    chatEl.innerHTML = `<h4>与 ${contact.name} 的聊天</h4>`;

    if (npcStateManager.isOffline(npcId) && contact.queueStatus !== "resolved") {
      chatEl.innerHTML += '<p class="dialogue-end">（对方已经很久没有上线了，消息始终没有回音。）</p>';
      return;
    }
    if (dayNightSystem.areRoommatesSleeping() && contact.queueStatus !== "resolved") {
      chatEl.innerHTML += '<p class="dialogue-end">（对方正在睡觉，暂时无法聊天。）</p>';
      return;
    }
    if (npcStateManager.isDistressed(npcId)) {
      const warn = document.createElement("p");
      warn.className = "his-activity-note npc-distress-warning";
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
      bubblesEl.replaceChildren(bubble);
      keywordManager.bindHighlights(bubble, keywordDefs);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    if (!contact.queueEntry) {
      bubblesEl.innerHTML = "<p class=\"dialogue-end\">（该内容尚未转换为活动蓝图。）</p>";
      return;
    }
    const runner = createActivityRunner({
      definition: contact,
      instance: contact.queueEntry,
      appendLine: (speaker, label, text) => appendBubble(speaker === "npc" ? "npc" : "me", text),
      optionsEl,
      appId: "social",
      onCheckpoint: (instance) => {
        return socialQueue.updateInstance(instance.instanceId, instance);
      },
      onComplete: (instance) => socialQueue.complete(instance.instanceId),
    });

    runner.start();
  }

  async function renderCurrentEntry() {
    await activityData.init();
    const contacts = socialQueue.getAll().map((item) => ({
      ...item.payload,
      id: item.instanceId,
      queueInstanceId: item.instanceId,
      queueStatus: item.status,
      receivedDay: item.receivedDay,
      receivedTime: item.receivedTime,
      queueEntry: item,
    }));
    const entry = { contacts };
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
