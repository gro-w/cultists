import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";
import { dialogueProgress } from "../core/DialogueProgress.js";

/**
 * Pick the schedule entry that matches the current day+phase, falling back
 * to cycling through the authored entries for that phase when `day` goes
 * beyond what was authored (so the game never runs out of content).
 */
function pickScheduleEntry(schedule, day, phase) {
  const phaseEntries = (schedule || [])
    .filter((e) => e.phase === phase)
    .sort((a, b) => a.day - b.day);
  if (phaseEntries.length === 0) return null;
  const exact = phaseEntries.find((e) => e.day === day);
  if (exact) return exact;
  const idx = (Math.max(1, day) - 1) % phaseEntries.length;
  return phaseEntries[idx];
}

/**
 * SocialApp - Social media style chat client.
 * Always accessible, but the contact/conversation content varies by the
 * current in-game day/phase (data-driven via `data/social_schedule.json`).
 */
export async function launchSocialApp() {
  const schedule = await dataLoader.loadJSON("social_schedule.json");

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
      (c.keywords || []).forEach((k) => {
        keywordDefs[k.id] = { ...k, source: `室友-${c.name}` };
      });
    });
    keywordManager.registerDefinitions(keywordDefs);
    return keywordDefs;
  }

  function renderContacts(entry, keywordDefs) {
    contactListEl.innerHTML = `<h4>联系人（第${gameState.day}天 · ${
      gameState.phase === "day" ? "白天" : "夜晚"
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
      btn.textContent = `${contact.avatar || "🙂"} ${contact.name}`;
      btn.addEventListener("click", () => renderChat(contact, keywordDefs));
      contactListEl.appendChild(btn);
    });

    const resumeId = dialogueProgress.get("social").actorId;
    const resumeContact = entry.contacts.find((c) => c.id === resumeId);
    renderChat(resumeContact || entry.contacts[0], keywordDefs);
  }

  function renderChat(contact, keywordDefs) {
    chatEl.innerHTML = `<h4>与 ${contact.name} 的聊天</h4>`;
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

    function showNode(nodeId) {
      const tree = contact.dialogueTree;
      const node = tree && tree.nodes[nodeId];
      optionsEl.innerHTML = "";
      if (!node) return;
      dialogueProgress.set("social", contact.id, nodeId);

      appendBubble(node.speaker === "npc" ? "npc" : "me", node.text);

      if (node.options && node.options.length > 0) {
        node.options.forEach((opt) => {
          const btn = document.createElement("button");
          btn.className = "win95-btn bevel-out dialogue-option-btn";
          btn.textContent = opt.label;
          btn.addEventListener("click", () => {
            appendBubble("me", opt.label);
            showNode(opt.next);
          });
          optionsEl.appendChild(btn);
        });
      } else {
        optionsEl.innerHTML = '<p class="dialogue-end">（对话已结束）</p>';
      }
    }

    if (contact.dialogueTree) {
      const resumeNodeId =
        dialogueProgress.get("social").actorId === contact.id
          ? dialogueProgress.get("social").nodeId
          : null;
      showNode(resumeNodeId || contact.dialogueTree.start);
    }
  }

  function renderCurrentEntry() {
    const entry = pickScheduleEntry(schedule.schedule, gameState.day, gameState.phase);
    if (!entry) {
      contactListEl.innerHTML = '<h4>联系人</h4><p class="his-empty">（今日暂无安排）</p>';
      chatEl.innerHTML = "";
      return;
    }
    const keywordDefs = registerKeywords(entry);
    renderContacts(entry, keywordDefs);
  }

  const unsubscribe = eventBus.on("daynight:changed", renderCurrentEntry);

  renderCurrentEntry();

  return windowManager.createWindow({
    appId: "social",
    title: "夜聊 Messenger",
    icon: "💬",
    width: 560,
    height: 420,
    content: root,
    onClose: unsubscribe,
  });
}
