import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { eventBus } from "../core/EventBus.js";

const FALLBACK_ANSWER = "对不起，我无法回答这个问题。";
const MAX_SELECTED_KEYWORDS = 2;

/**
 * ChatGTPApp - a ChatGPT-styled assistant. The player can:
 *   - type free text and send it as a single query, or
 *   - select one or up to two collected keywords from the notebook and
 *     submit them together as a combined query.
 * Responses are looked up from `data/chatgtp_qa.json` by matching the
 * exact (order-independent) set of keyword labels used in the query.
 * Answers may themselves contain `[[keywordId]]` markers, revealing new
 * keywords the player can click to collect.
 *
 * Since the window is single-instance (`appId: "chatgtp"`), other apps
 * (e.g. NotebookApp's double-click-to-query shortcut) preselect a keyword
 * in an already-open instance via the `chatgtp:select-keyword` eventBus
 * event rather than calling this function's options directly.
 * @param {object} [options]
 * @param {string} [options.presetKeywordId] - keyword id to preselect on open
 */
export async function launchChatGTPApp(options = {}) {
  // If already open, just focus it and forward any preselected keyword via
  // the eventBus instead of rebuilding the whole app (avoids leaking a
  // second set of subscriptions onto a window instance we'd discard).
  const existing = windowManager.getByAppId("chatgtp");
  if (existing) {
    windowManager.focus(existing.id);
    if (options.presetKeywordId) {
      eventBus.emit("chatgtp:select-keyword", { id: options.presetKeywordId });
    }
    return existing;
  }

  const qa = await dataLoader.loadJSON("chatgtp_qa.json");

  // Keywords that ChatGTP's answers can introduce/reveal, resolved from the
  // central `data/keywords.json` registry (already loaded at boot) and
  // tagged with a "ChatGTP 问答" source for the Notebook.
  const ownKeywordDefs = keywordManager.definitionsWithSource(
    qa.revealKeywordIds || [],
    "ChatGTP 问答"
  );

  // Index entries by their sorted, normalized keyword-label set for
  // order-independent single/combo lookups.
  const entryIndex = new Map();
  (qa.entries || []).forEach((entry) => {
    const key = normalizeSet(entry.keywords || []);
    entryIndex.set(key, entry.answer);
  });

  const root = document.createElement("div");
  root.className = "app-chatgtp";
  root.innerHTML = `
    <div class="chatgtp-layout">
      <div class="chatgtp-history panel-inset"></div>
      <div class="chatgtp-keywords panel-inset">
        <h4>选择 1-2 个关键词进行组合查询：</h4>
        <div class="chatgtp-keyword-chips"></div>
        <button type="button" class="win95-btn bevel-out chatgtp-query-btn">查询选中关键词</button>
      </div>
      <div class="chatgtp-input-row">
        <input type="text" class="win95-input chatgtp-input" placeholder="输入问题或关键词..." />
        <button type="button" class="win95-btn bevel-out chatgtp-send">发送</button>
      </div>
    </div>
  `;

  const historyEl = root.querySelector(".chatgtp-history");
  const chipsEl = root.querySelector(".chatgtp-keyword-chips");
  const queryBtn = root.querySelector(".chatgtp-query-btn");
  const inputEl = root.querySelector(".chatgtp-input");
  const sendBtn = root.querySelector(".chatgtp-send");

  /** @type {Set<string>} ids of keywords currently selected for combo query */
  const selectedIds = new Set();

  function normalizeLabel(s) {
    return (s || "").trim().toLowerCase();
  }

  function normalizeSet(labels) {
    return labels.map(normalizeLabel).sort().join("+");
  }

  function appendMessage(role, html) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble bubble-${role}`;
    bubble.innerHTML = html;
    historyEl.appendChild(bubble);
    keywordManager.bindHighlights(bubble, ownKeywordDefs);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function answerFor(labels) {
    return entryIndex.get(normalizeSet(labels)) || FALLBACK_ANSWER;
  }

  function ask(queryText, labels) {
    if (!queryText) return;
    appendMessage("me", escapeHtml(queryText));
    const answer = answerFor(labels);
    appendMessage("npc", keywordManager.renderHighlightedText(answer, ownKeywordDefs));
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function renderKeywordChips() {
    // Selected keywords may have been removed from the notebook; drop them
    // before rendering so the MAX_SELECTED_KEYWORDS check below stays accurate.
    [...selectedIds].forEach((id) => {
      if (!keywordManager.has(id)) selectedIds.delete(id);
    });

    chipsEl.innerHTML = "";
    const collected = keywordManager.all();
    if (collected.length === 0) {
      chipsEl.innerHTML = `<p class="notebook-empty">笔记本中暂无关键词。</p>`;
    }
    collected.forEach((kw) => {
      const chip = document.createElement("button");
      chip.type = "button";
      const isSelected = selectedIds.has(kw.id);
      chip.className = `win95-btn bevel-out keyword-chip${isSelected ? " selected" : ""}`;
      chip.textContent = kw.label;
      chip.disabled = !isSelected && selectedIds.size >= MAX_SELECTED_KEYWORDS;
      chip.addEventListener("click", () => {
        if (isSelected) {
          selectedIds.delete(kw.id);
        } else if (selectedIds.size < MAX_SELECTED_KEYWORDS) {
          selectedIds.add(kw.id);
        }
        renderKeywordChips();
      });
      chipsEl.appendChild(chip);
    });
  }

  queryBtn.addEventListener("click", () => {
    if (selectedIds.size === 0) return;
    const selectedKeywords = [...selectedIds].map((id) => keywordManager.get(id)).filter(Boolean);
    const labels = selectedKeywords.map((k) => k.label);
    ask(labels.join(" + "), labels);
    selectedIds.clear();
    renderKeywordChips();
  });

  sendBtn.addEventListener("click", () => {
    const value = inputEl.value;
    inputEl.value = "";
    ask(value, [value]);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });

  /**
   * Select a keyword (by id) for combo query, if it's currently collected
   * and the selection isn't already full. Used both by preset options and
   * by the `chatgtp:select-keyword` event (e.g. Notebook double-click).
   */
  function selectKeyword(id) {
    if (!id || !keywordManager.has(id)) return;
    if (!selectedIds.has(id) && selectedIds.size >= MAX_SELECTED_KEYWORDS) {
      // Make room by dropping the oldest selection so the newly requested
      // keyword can still be added.
      const [oldest] = selectedIds;
      selectedIds.delete(oldest);
    }
    selectedIds.add(id);
    renderKeywordChips();
  }

  const offSelectKeyword = eventBus.on("chatgtp:select-keyword", ({ id }) => selectKeyword(id));

  const offKeywordChange = keywordManager.onChange(() => renderKeywordChips());
  renderKeywordChips();
  appendMessage("npc", "你好，我是 ChatGTP，你可以输入问题，或从笔记本中选择 1-2 个关键词进行组合查询～");
  if (options.presetKeywordId) selectKeyword(options.presetKeywordId);

  return windowManager.createWindow({
    appId: "chatgtp",
    title: "ChatGTP",
    icon: "🤖",
    width: 480,
    height: 480,
    content: root,
    onClose: () => {
      offKeywordChange();
      offSelectKeyword();
    },
  });
}
