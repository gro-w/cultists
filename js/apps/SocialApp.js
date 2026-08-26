import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";

/**
 * SocialApp - Social media style chat client (night-phase only).
 * Lets the player chat with roommates/NPCs, collecting highlighted
 * keywords that surface late-night story clues.
 */
export async function launchSocialApp() {
  const data = await dataLoader.loadJSON("dialogues_night.json");

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

  const keywordDefs = {};
  (data.contacts || []).forEach((c) => {
    (c.keywords || []).forEach((k) => {
      keywordDefs[k.id] = { ...k, source: `室友-${c.name}` };
    });
  });
  keywordManager.registerDefinitions(keywordDefs);

  function renderContacts() {
    contactListEl.innerHTML = "<h4>联系人</h4>";
    (data.contacts || []).forEach((contact) => {
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out social-contact-btn";
      btn.textContent = `${contact.avatar || "🙂"} ${contact.name}`;
      btn.addEventListener("click", () => renderChat(contact));
      contactListEl.appendChild(btn);
    });
  }

  function renderChat(contact) {
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
      showNode(contact.dialogueTree.start);
    }
  }

  renderContacts();
  if (data.contacts && data.contacts[0]) renderChat(data.contacts[0]);

  return windowManager.createWindow({
    appId: "social",
    title: "夜聊 Messenger",
    icon: "💬",
    width: 560,
    height: 420,
    content: root,
  });
}
