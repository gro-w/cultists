import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { runItemSchedule } from "../core/ItemScheduleRuntime.js";
import { mainQueue } from "../core/ScheduleQueue.js";


import { settingsManager, NOTEBOOK_SORT_MODES } from "../core/SettingsManager.js";
import { getPinyinInitial } from "../core/Pinyin.js";

const FALLBACK_ANSWER = "对不起，我无法回答这个问题。";
const MAX_SELECTED_KEYWORDS = 2;
const CHATGTP_ACTOR_ID = "chatgtp";
const NOTEBOOK_CATEGORY_LABELS = {
  symptom: "症状",
  item: "物品",
  clue: "线索",
  drug: "药品",
  misc: "其他",
};

/**
 * ChatGTPApp - a ChatGPT-styled assistant:
 *   - "关键词问答": select 1-2 keywords and get a looked-up answer from
 *     `data/chatgtp_qa.json`.
 * ChatGTP has its OWN SAN (tracked via NpcStateManager under the actor id
 * "chatgtp", same mechanism as any patient/contact): every keyword-QA
 * query costs `sanCostPerQuery` SAN. Once its SAN drops
 * below the "distressed" threshold, each matched entry chooses its own
 * corrupted answer (or reuses the normal answer); once it goes fully offline,
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
  const existing = options.container ? null : windowManager.getByAppId("chatgtp");
  if (existing) {
    windowManager.focus(existing.id);
    if (options.presetKeywordId) {
      eventBus.emit("chatgtp:select-keyword", { id: options.presetKeywordId });
    }
    return existing;
  }

  const [qa, socialApps, diagnoses, medicines] = await Promise.all([
    dataLoader.loadJSON("chatgtp_qa.json"),
    dataLoader.loadJSON("social_apps.json"),
    dataLoader.loadJSON("diagnoses.json"),
    dataLoader.loadJSON("medicines.json"),
  ]);
  await keywordManager.load();
  const sanCostPerQuery = Number(qa.sanCostPerQuery) || 0;
  const offlineAnswer = qa.offlineAnswer || FALLBACK_ANSWER;

  // Keywords that ChatGTP's answers can introduce/reveal, resolved from the
  // central `data/keywords.json` registry (already loaded at boot) and
  // tagged with a "ChatGTP 问答" source for the Notebook.
  const ownKeywordDefs = keywordManager.definitionsWithSource(
    qa.revealKeywordIds || [],
    "ChatGTP 问答"
  );

  // Index entries by their sorted, normalized keyword-id set for
  // order-independent single/combo lookups.
  const entryIndex = new Map();
  (qa.entries || []).forEach((entry) => {
    const key = normalizeSet(entry.keywords || []);
    entryIndex.set(key, entry);
  });
  const categoryIndex = new Map((diagnoses.categories || []).map((category) => [category.id, category]));
  const diseaseIndex = new Map((diagnoses.categories || []).flatMap((category) => category.diagnoses || []).map((disease) => [disease.id, disease]));

  const root = document.createElement("div");
  root.className = "app-chatgtp";
  root.innerHTML = `
    <div class="chatgtp-san-indicator"></div>
    <div class="chatgtp-layout">
        <div class="chatgtp-history panel-inset"></div>
        <div class="chatgtp-keywords panel-inset">
          <h4>选择 1-2 个关键词进行查询：</h4>
          <div class="chatgtp-disease-row">
            <select class="win95-select chatgtp-category-select">
              <option value="">-- 选择关键词类别（可选） --</option>
            </select>
            <select class="win95-select chatgtp-disease-select">
              <option value="">-- 选择疾病关键词（可选） --</option>
            </select>
          </div>
          <div class="chatgtp-medicine-row">
            <select class="win95-select chatgtp-medicine-category-select">
              <option value="">-- 选择药物分类（可选） --</option>
            </select>
            <select class="win95-select chatgtp-medicine-select">
              <option value="">-- 选择药物关键词（可选） --</option>
            </select>
          </div>
          <div class="chatgtp-notebook-row">
            <select class="win95-select chatgtp-notebook-category-select">
              <option value="">-- 笔记本类别（可选） --</option>
            </select>
            <select class="win95-select chatgtp-notebook-select">
              <option value="">-- 选择笔记本关键词（可选） --</option>
            </select>
          </div>
          <div class="chatgtp-selected-keywords">
            <button type="button" class="win95-btn bevel-out chatgtp-selected-keyword" data-slot="0">关键词1：未选择</button>
            <button type="button" class="win95-btn bevel-out chatgtp-selected-keyword" data-slot="1">关键词2：未选择</button>
            <button type="button" class="win95-btn bevel-out chatgtp-query-btn">查询</button>
          </div>
        </div>

    </div>
  `;

  const sanIndicatorEl = root.querySelector(".chatgtp-san-indicator");
  const historyEl = root.querySelector(".chatgtp-history");
  const notebookCategorySelect = root.querySelector(".chatgtp-notebook-category-select");
  const notebookSelect = root.querySelector(".chatgtp-notebook-select");
  const categorySelect = root.querySelector(".chatgtp-category-select");
  const diseaseSelect = root.querySelector(".chatgtp-disease-select");
  const medicineCategorySelect = root.querySelector(".chatgtp-medicine-category-select");
  const medicineSelect = root.querySelector(".chatgtp-medicine-select");
  const queryBtn = root.querySelector(".chatgtp-query-btn");
  const selectedKeywordEls = [...root.querySelectorAll(".chatgtp-selected-keyword")];


  /** @type {Set<string>} ids of keywords currently selected for combo query */
  const selectedIds = new Set();
  let selectedCategoryId = null;
  let selectedMedicineCategoryId = null;
  let selectedNotebookCategory = "";



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

  function normalizeKeywordValue(value) {
    const normalized = normalizeLabel(value);
    const definition = keywordManager.getDefinition(value)
      || keywordManager.all().find((entry) => normalizeLabel(entry.content || entry.label) === normalized)
      || [...keywordManager.definitions.values()].find((entry) => normalizeLabel(entry.content || entry.label) === normalized);
    return definition ? definition.id : normalized;
  }

  function normalizeSet(labels) {
    return labels.map(normalizeKeywordValue).sort().join("+");
  }

  function appendMessage(role, html) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble bubble-${role}`;
    bubble.innerHTML = html;
    historyEl.appendChild(bubble);
    keywordManager.bindHighlights(bubble, ownKeywordDefs);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function renderDailyMessages() {
    const daily = socialApps.chatgtpDaily || [];
    const day = gameState.day;
    const entry = daily.find((item) => item.day === day) ?? (day <= daily.length ? daily[day - 1] : null);
    const pairs = entry?.pairs || [];
    if (pairs.length === 0) return;

    const banner = document.createElement("div");
    banner.className = "chatgtp-daily-banner";
    let pairIndex = 0;
    const renderBanner = () => {
      if (pairIndex >= pairs.length) {
        banner.textContent = "📬 今日预设对话：已全部查看。";
        return;
      }
      banner.replaceChildren();
      const label = document.createElement("span");
      label.className = "chatgtp-daily-label";
      label.textContent = `📬 今日消息 (${pairIndex + 1}/${pairs.length})`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "win95-btn bevel-out chatgtp-daily-btn";
      button.textContent = "查看";
      button.addEventListener("click", () => {
        const pair = pairs[pairIndex];
        appendMessage("me", escapeHtml(pair.q || ""));
        appendMessage("npc", escapeHtml(pair.a || ""));
        pairIndex += 1;
        renderBanner();
      });
      banner.append(label, button);
    };
    renderBanner();
    historyEl.prepend(banner);
  }

  function answerFor(labels) {
    return entryIndex.get(normalizeSet(labels)) || null;
  }

  function diseaseKeywordId(disease) {
    const lowSan = gameState.mental <= Number(diagnoses.lowSanThreshold ?? 30);
    return `disease:${disease.id}:${lowSan ? "low" : "normal"}`;
  }

  function renderCategoryOptions() {
    categorySelect.innerHTML = '<option value="">-- 选择关键词类别（可选） --</option>';
    categoryIndex.forEach((category) => {
      const low = gameState.mental <= Number(diagnoses.lowSanThreshold ?? 30);
      const id = `disease-category:${category.id}:${low ? "low" : "normal"}`;
      const option = document.createElement("option"); option.value = id; option.textContent = low ? category.lowSanName || category.name : category.name;
      categorySelect.appendChild(option);
    });
  }
  function renderDiseaseOptions() {
    diseaseSelect.innerHTML = '<option value="">-- 选择疾病关键词（可选） --</option>';
    if (selectedCategoryId) {
      const category = categoryIndex.get(selectedCategoryId);
      if (category) {
        const low = gameState.mental <= Number(diagnoses.lowSanThreshold ?? 30);
        const categoryKeywordId = `disease-category:${category.id}:${low ? "low" : "normal"}`;
        const categoryOption = document.createElement("option");
        categoryOption.value = categoryKeywordId;
        categoryOption.textContent = `分类：${low ? category.lowSanName || category.name : category.name}`;
        diseaseSelect.appendChild(categoryOption);
      }
    }
    const diseases = selectedCategoryId
      ? (categoryIndex.get(selectedCategoryId)?.diagnoses || [])
      : [...diseaseIndex.values()];
    diseases.forEach((disease) => {
      const option = document.createElement("option");
      const id = diseaseKeywordId(disease);
      option.value = id;
      option.textContent = `${disease.icd10} · ${keywordManager.getDefinition(id)?.content || disease.id}`;
      diseaseSelect.appendChild(option);
    });
  }
  function renderMedicineOptions() {
    medicineSelect.innerHTML = '<option value="">-- 选择药物关键词（可选） --</option>';
    const selectedCategory = (medicines.categories || []).find((category) => category.id === selectedMedicineCategoryId);
    const allowedMedicineIds = selectedCategory ? new Set(selectedCategory.medicineIds || []) : null;
    (medicines.medicines || []).filter((medicine) => !allowedMedicineIds || allowedMedicineIds.has(medicine.id)).forEach((medicine) => {
      const keyword = keywordManager.getDefinition(medicine.id);
      const option = document.createElement("option");
      option.value = medicine.id;
      option.textContent = keyword?.content || medicine.name || medicine.id;
      medicineSelect.appendChild(option);
    });
  }
  function renderMedicineCategoryOptions() {
    medicineCategorySelect.innerHTML = '<option value="">-- 选择药物分类（可选） --</option>';
    (medicines.categories || []).forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.name;
      medicineCategorySelect.appendChild(option);
    });
    medicineCategorySelect.value = selectedMedicineCategoryId || "";
  }
  renderCategoryOptions();
  renderDiseaseOptions();
  renderMedicineCategoryOptions();
  renderMedicineOptions();

  function addSelectedKeyword(id) {
    if (!id) return;
    if (selectedIds.has(id)) return;
    if (selectedIds.size >= MAX_SELECTED_KEYWORDS) {
      const [oldest] = selectedIds;
      selectedIds.delete(oldest);
    }
    selectedIds.add(id);
    renderSelectedKeywords();
  }

  function selectedKeywordList() {
    return [...selectedIds].map((id) => keywordManager.get(id) || keywordManager.getDefinition(id)).filter(Boolean);
  }

  function renderSelectedKeywords() {
    const selected = selectedKeywordList();
    selectedKeywordEls.forEach((button, index) => {
      const keyword = selected[index];
      button.textContent = `关键词${index + 1}：${keyword ? keywordManager.displayContent(keyword) : "未选择"}`;
      button.classList.toggle("selected", Boolean(keyword));
    });
  }

  selectedKeywordEls.forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.slot);
    const ids = [...selectedIds];
    if (!ids[index]) return;
    selectedIds.delete(ids[index]);
    renderSelectedKeywords();
  }));

  function notebookGroups() {
    const groups = new Map();
    const push = (key, title, keyword) => {
      if (!groups.has(key)) groups.set(key, { title, keywords: [] });
      groups.get(key).keywords.push(keyword);
    };
    keywordManager.all().forEach((keyword) => {
      if (settingsManager.notebookSortMode === NOTEBOOK_SORT_MODES.DAY) {
        const day = keyword.collectedDay;
        push(day == null ? "unknown" : `day_${day}`, day == null ? "未知天数" : `第 ${day} 天`, keyword);
      } else if (settingsManager.notebookSortMode === NOTEBOOK_SORT_MODES.PINYIN) {
        const initial = getPinyinInitial(keyword.content || keyword.id);
        push(initial, initial, keyword);
      } else {
        const category = keyword.category || "misc";
        push(category, NOTEBOOK_CATEGORY_LABELS[category] || category, keyword);
      }
    });
    return [...groups.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, "zh-Hans-CN", { numeric: true }));
  }

  function renderNotebookCategoryOptions() {
    const current = selectedNotebookCategory;
    notebookCategorySelect.innerHTML = '<option value="">-- 选择笔记本类别（可选） --</option>';
    notebookGroups().forEach(([key, group]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = group.title;
      notebookCategorySelect.appendChild(option);
    });
    notebookCategorySelect.value = current;
  }

  function renderNotebookOptions() {
    const current = notebookSelect.value;
    notebookSelect.innerHTML = '<option value="">-- 选择笔记本关键词（可选） --</option>';
    const groups = new Map(notebookGroups());
    const keywords = selectedNotebookCategory && groups.has(selectedNotebookCategory)
      ? groups.get(selectedNotebookCategory).keywords
      : keywordManager.all();
    keywords.forEach((keyword) => {
      const option = document.createElement("option");
      option.value = keyword.id;
      option.textContent = keywordManager.displayContent(keyword);
      notebookSelect.appendChild(option);
    });
    notebookSelect.value = current;
  }

  categorySelect.addEventListener("change", () => {
    const match = /^disease-category:(.+):(normal|low)$/.exec(categorySelect.value);
    selectedCategoryId = match?.[1] || null;
    renderDiseaseOptions();
  });
  diseaseSelect.addEventListener("change", () => {
    addSelectedKeyword(diseaseSelect.value);
    diseaseSelect.value = "";
  });
  medicineSelect.addEventListener("change", () => {
    addSelectedKeyword(medicineSelect.value);
    medicineSelect.value = "";
  });
  medicineCategorySelect.addEventListener("change", () => {
    selectedMedicineCategoryId = medicineCategorySelect.value || null;
    renderMedicineOptions();
  });
  notebookSelect.addEventListener("change", () => {
    addSelectedKeyword(notebookSelect.value);
    notebookSelect.value = "";
  });
  notebookCategorySelect.addEventListener("change", () => {
    selectedNotebookCategory = notebookCategorySelect.value;
    renderNotebookOptions();
  });

  function ask(queryText, labels) {
    if (!queryText) return;
    const instance = mainQueue.append([{
      scheduleId: "chatgtp:query",
      status: "unresolved",
      transcript: [],
    }])[0];
    const entry = answerFor(labels);
    let answer = entry?.answer || FALLBACK_ANSWER;
    if (npcStateManager.isDistressed(CHATGTP_ACTOR_ID) && entry && !entry.corruptedSameAsNormal) {
      answer = entry.corruptedAnswer || entry.answer || FALLBACK_ANSWER;
    }
    runItemSchedule({
      source: "chatgtp",
      action: "query",
      queueId: "main",
      instance,
      context: {
        effect: sanCostPerQuery > 0 ? { npcSanChanges: [{ actorId: CHATGTP_ACTOR_ID, delta: -sanCostPerQuery }] } : {},
        timeMinutes: 20,
        onComplete: () => {
          appendMessage("me", escapeHtml(queryText));
          appendMessage("npc", keywordManager.renderHighlightedText(
            npcStateManager.isOffline(CHATGTP_ACTOR_ID) ? offlineAnswer : answer.replace(/\n/g, "<br>"),
            ownKeywordDefs,
          ));
        },
      },
    });
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
      if (!keywordManager.has(id) && !keywordManager.getDefinition(id)) selectedIds.delete(id);
    });

    renderSelectedKeywords();
    renderNotebookCategoryOptions();
    renderNotebookOptions();
  }

  queryBtn.addEventListener("click", () => {
    if (selectedIds.size === 0) return;
    const selectedKeywords = selectedKeywordList();
    const ids = selectedKeywords.map((k) => k.id);
    const labels = selectedKeywords.map((k) => keywordManager.displayContent(k));
    ask(labels.join(" + "), ids);
    selectedIds.clear();
    selectedCategoryId = null;
    selectedNotebookCategory = "";
    renderKeywordChips();
  });


  /**
   * Select a keyword (by id) for combo query, if it's currently collected
   * and the selection isn't already full. Used both by preset options and
   * by the `chatgtp:select-keyword` event (e.g. Notebook double-click).
   */
  function selectKeyword(id) {
    if (!id || (!keywordManager.has(id) && !keywordManager.getDefinition(id))) return;

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
  const offNpcState = npcStateManager.onChange(({ actorId }) => {
    if (!actorId || actorId === CHATGTP_ACTOR_ID) updateSanIndicator();
  });
  const offSettings = settingsManager.onChange(() => {
    selectedNotebookCategory = "";
    renderKeywordChips();
  });
  const offGameState = eventBus.on("gamestate:changed", () => { renderCategoryOptions(); renderDiseaseOptions(); });

  renderKeywordChips();
  updateSanIndicator();
  appendMessage("npc", "你好，我是 ChatGTP，你可以输入问题、选择疾病关键词，或用疾病关键词与普通关键词组合查询～");
  renderDailyMessages();
  if (options.presetKeywordId) selectKeyword(options.presetKeywordId);


  if (options.container) {
    options.container.replaceChildren(root);
    return root;
  }

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
      offSettings();
      offGameState();
    },
  });
}
