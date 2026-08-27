import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { eventBus } from "../core/EventBus.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { createDialogueRunner } from "../core/DialogueRunner.js";

const FALLBACK_ANSWER = "对不起，我无法回答这个问题。";
const MAX_SELECTED_KEYWORDS = 2;
const CHATGTP_ACTOR_ID = "chatgtp";

/**
 * ChatGTPApp - a ChatGPT-styled assistant, split into two tabs:
 *   - "关键词问答" (原本功能): type free text, or select 1-2 collected
 *     keywords, and get a looked-up answer from `data/chatgtp_qa.json`.
 *   - "对话模式": a normal branching NPC-style conversation (walked via the
 *     same `createDialogueRunner` HIS/Social/Monitor use), authored as
 *     `chatgtp_qa.json`'s `dialogueMode` tree.
 *
 * ChatGTP has its OWN SAN (tracked via NpcStateManager under the actor id
 * "chatgtp", same mechanism as any patient/contact): every keyword-QA
 * query costs `sanCostPerQuery` SAN, and dialogue-mode nodes can carry
 * `onShow.npcSanChange` same as any other dialogueTree. Once its SAN drops
 * below the "distressed" threshold, keyword-QA answers have a chance to be
 * replaced by a `corruptedAnswers` entry instead of the real lookup
 * (ChatGTP "hallucinating" from strain); once it goes fully offline,
 * queries get `offlineAnswer` instead of any real answer.
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
  const sanCostPerQuery = Number(qa.sanCostPerQuery) || 0;
  const corruptedAnswers = qa.corruptedAnswers || [];
  const offlineAnswer = qa.offlineAnswer || FALLBACK_ANSWER;

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
    <div class="chatgtp-tabs">
      <button type="button" class="win95-btn bevel-out chatgtp-tab-btn" data-tab="qa">关键词问答</button>
      <button type="button" class="win95-btn bevel-out chatgtp-tab-btn" data-tab="dialogue">对话模式</button>
      <span class="chatgtp-san-indicator"></span>
    </div>
    <div class="chatgtp-tab-panel" data-panel="qa">
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
    </div>
    <div class="chatgtp-tab-panel" data-panel="dialogue" hidden>
      <div class="chatgtp-dialogue-layout panel-inset">
        <div class="dialogue-lines chatgtp-dialogue-lines"></div>
        <div class="dialogue-options"></div>
      </div>
    </div>
  `;

  const tabButtons = [...root.querySelectorAll(".chatgtp-tab-btn")];
  const panels = {
    qa: root.querySelector('[data-panel="qa"]'),
    dialogue: root.querySelector('[data-panel="dialogue"]'),
  };
  const sanIndicatorEl = root.querySelector(".chatgtp-san-indicator");
  const historyEl = root.querySelector(".chatgtp-history");
  const chipsEl = root.querySelector(".chatgtp-keyword-chips");
  const queryBtn = root.querySelector(".chatgtp-query-btn");
  const inputEl = root.querySelector(".chatgtp-input");
  const sendBtn = root.querySelector(".chatgtp-send");
  const dialogueLinesEl = root.querySelector(".chatgtp-dialogue-lines");
  const dialogueOptionsEl = root.querySelector(".dialogue-options");

  /** @type {Set<string>} ids of keywords currently selected for combo query */
  const selectedIds = new Set();
  let dialogueStarted = false;
  let dialogueCurrentNode = null;

  function selectTab(name) {
    tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
    Object.entries(panels).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    if (name === "dialogue" && !dialogueStarted) {
      dialogueStarted = true;
      startDialogueMode();
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => selectTab(btn.dataset.tab));
  });

  function updateSanIndicator() {
    const offline = npcStateManager.isOffline(CHATGTP_ACTOR_ID);
    const distressed = !offline && npcStateManager.isDistressed(CHATGTP_ACTOR_ID);
    const san = npcStateManager.get(CHATGTP_ACTOR_ID);
    sanIndicatorEl.textContent = offline
      ? `🚫 ChatGTP 已离线（SAN ${san}）`
      : distressed
      ? `⚠️ ChatGTP 状态不稳定（SAN ${san}）`
      : `SAN ${san}`;
    sanIndicatorEl.className = `chatgtp-san-indicator${offline ? " offline" : distressed ? " distressed" : ""}`;
  }

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
    // A keyword query is still an active conversation with ChatGTP, so it
    // advances the shared phase clock just like an NPC dialogue turn.
    eventBus.emit("dialogue:turn", { appId: "chatgtp", actorId: CHATGTP_ACTOR_ID });
    appendMessage("me", escapeHtml(queryText));

    if (npcStateManager.isOffline(CHATGTP_ACTOR_ID)) {
      appendMessage("npc", escapeHtml(offlineAnswer));
      return;
    }

    let answer = answerFor(labels);
    // Once distressed, strain has a chance to corrupt the response into a
    // fabricated/garbled one instead of the real lookup - a visible sign
    // ChatGTP's own SAN loss is affecting the reliability of its answers.
    if (npcStateManager.isDistressed(CHATGTP_ACTOR_ID) && corruptedAnswers.length > 0 && Math.random() < 0.6) {
      answer = corruptedAnswers[Math.floor(Math.random() * corruptedAnswers.length)];
    }
    appendMessage("npc", keywordManager.renderHighlightedText(answer, ownKeywordDefs));

    if (sanCostPerQuery > 0) npcStateManager.modify(CHATGTP_ACTOR_ID, -sanCostPerQuery);
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

  /** "对话模式" tab: walk `chatgtp_qa.json`'s `dialogueMode` tree like any NPC. */
  function startDialogueMode() {
    const tree = qa.dialogueMode;
    if (!tree) {
      dialogueLinesEl.innerHTML = '<p class="dialogue-end">（暂无对话模式内容）</p>';
      return;
    }
    const actor = { id: CHATGTP_ACTOR_ID, name: "ChatGTP", dialogueTree: tree };

    function appendLine(speaker, label, text) {
      const p = document.createElement("p");
      p.className = `dialogue-line speaker-${speaker}`;
      p.innerHTML = `<strong>${label}:</strong> ${keywordManager.renderHighlightedText(text, ownKeywordDefs)}`;
      dialogueLinesEl.appendChild(p);
      keywordManager.bindHighlights(p, ownKeywordDefs);
      dialogueLinesEl.scrollTop = dialogueLinesEl.scrollHeight;
    }

    const runner = createDialogueRunner({
      actor,
      appendLine,
      optionsEl: dialogueOptionsEl,
      optionBtnClass: "win95-btn bevel-out dialogue-option-btn",
      appId: "chatgtp",
      onNodeShown: (nodeId) => {
        dialogueCurrentNode = nodeId;
      },
      emptyMessage: "（暂无对话模式内容）",
    });

    if (npcStateManager.isOffline(CHATGTP_ACTOR_ID)) {
      dialogueLinesEl.innerHTML = '<p class="dialogue-end">（ChatGTP 已经宕机，无法进入对话模式。）</p>';
      return;
    }
    runner.showNode(dialogueCurrentNode || tree.start);
  }

  const offSelectKeyword = eventBus.on("chatgtp:select-keyword", ({ id }) => selectKeyword(id));
  const offKeywordChange = keywordManager.onChange(() => renderKeywordChips());
  const offNpcState = npcStateManager.onChange(({ actorId }) => {
    if (!actorId || actorId === CHATGTP_ACTOR_ID) updateSanIndicator();
  });

  renderKeywordChips();
  updateSanIndicator();
  appendMessage("npc", "你好，我是 ChatGTP，你可以输入问题，或从笔记本中选择 1-2 个关键词进行组合查询～");
  if (options.presetKeywordId) selectKeyword(options.presetKeywordId);
  selectTab("qa");

  return windowManager.createWindow({
    appId: "chatgtp",
    title: i18n.t("apps.chatgtp", "ChatGTP"),
    icon: "🤖",
    width: 500,
    height: 540,
    content: root,
    onClose: () => {
      offKeywordChange();
      offSelectKeyword();
      offNpcState();
    },
  });
}
