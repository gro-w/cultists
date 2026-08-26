import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";

const FALLBACK_ANSWER = "对不起，我无法回答这个问题。";

/**
 * ChatGTPApp - a ChatGPT-styled assistant. The player can type free text or
 * click a collected keyword to query it; the response is looked up from
 * `data/chatgtp_qa.json`. Unmatched queries return a fixed fallback reply.
 */
export async function launchChatGTPApp() {
  const qa = await dataLoader.loadJSON("chatgtp_qa.json");
  const qaMap = new Map((qa.entries || []).map((e) => [normalize(e.keyword), e.answer]));

  const root = document.createElement("div");
  root.className = "app-chatgtp";
  root.innerHTML = `
    <div class="chatgtp-layout">
      <div class="chatgtp-history panel-inset"></div>
      <div class="chatgtp-keywords panel-inset"></div>
      <div class="chatgtp-input-row">
        <input type="text" class="win95-input chatgtp-input" placeholder="输入问题或关键词..." />
        <button type="button" class="win95-btn bevel-out chatgtp-send">发送</button>
      </div>
    </div>
  `;

  const historyEl = root.querySelector(".chatgtp-history");
  const keywordsEl = root.querySelector(".chatgtp-keywords");
  const inputEl = root.querySelector(".chatgtp-input");
  const sendBtn = root.querySelector(".chatgtp-send");

  function normalize(s) {
    return (s || "").trim().toLowerCase();
  }

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble bubble-${role}`;
    bubble.textContent = text;
    historyEl.appendChild(bubble);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function ask(query) {
    if (!query) return;
    appendMessage("me", query);
    const answer = qaMap.get(normalize(query)) || FALLBACK_ANSWER;
    appendMessage("npc", answer);
  }

  function renderKeywordShortcuts() {
    keywordsEl.innerHTML = "<h4>点击关键词快速提问：</h4>";
    keywordManager.all().forEach((kw) => {
      const chip = document.createElement("button");
      chip.className = "win95-btn bevel-out keyword-chip";
      chip.textContent = kw.label;
      chip.addEventListener("click", () => ask(kw.label));
      keywordsEl.appendChild(chip);
    });
  }

  sendBtn.addEventListener("click", () => {
    const value = inputEl.value;
    inputEl.value = "";
    ask(value);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });

  const offKeywordChange = keywordManager.onChange(() => renderKeywordShortcuts());
  renderKeywordShortcuts();
  appendMessage("npc", "你好，我是 ChatGTP，你可以问我任何已知的关键词～");

  return windowManager.createWindow({
    appId: "chatgtp",
    title: "ChatGTP",
    icon: "🤖",
    width: 480,
    height: 440,
    content: root,
    onClose: () => offKeywordChange(),
  });
}
