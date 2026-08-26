import { windowManager } from "../core/WindowManager.js";
import { keywordManager } from "../core/KeywordManager.js";
import { settingsManager, NOTEBOOK_SORT_MODES } from "../core/SettingsManager.js";
import { getPinyinInitial } from "../core/Pinyin.js";
import { launchChatGTPApp } from "./ChatGTPApp.js";

const CATEGORY_LABELS = {
  symptom: "症状",
  item: "物品",
  clue: "线索",
  drug: "药品",
  misc: "其他",
};

/**
 * Group keywords according to the given sort mode, returning an array of
 * `{ title, list }` entries already sorted into a sensible order.
 * @param {object[]} keywords
 * @param {string} mode one of NOTEBOOK_SORT_MODES
 */
function groupKeywords(keywords, mode) {
  const groups = new Map();

  function pushTo(key, title, kw) {
    if (!groups.has(key)) groups.set(key, { title, list: [] });
    groups.get(key).list.push(kw);
  }

  keywords.forEach((kw) => {
    if (mode === NOTEBOOK_SORT_MODES.DAY) {
      const day = kw.collectedDay;
      const key = day == null ? "unknown" : `day_${String(day).padStart(6, "0")}`;
      const title = day == null ? "未知天数" : `第 ${day} 天`;
      pushTo(key, title, kw);
    } else if (mode === NOTEBOOK_SORT_MODES.PINYIN) {
      const initial = getPinyinInitial(kw.label);
      pushTo(initial, initial, kw);
    } else {
      const cat = kw.category || "misc";
      pushTo(cat, CATEGORY_LABELS[cat] || cat, kw);
    }
  });

  const entries = [...groups.values()];
  entries.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN", { numeric: true }));
  return entries;
}

/**
 * NotebookApp - real-time view of every keyword collected so far, grouped
 * by category / collection day / pinyin initial (configurable via the
 * Settings app). Only shows the keyword label and its source (no detailed
 * definition) and lets the player delete a keyword from the notebook.
 * Subscribes to KeywordManager + SettingsManager so it always reflects the
 * latest global state.
 */
export async function launchNotebookApp() {
  const root = document.createElement("div");
  root.className = "app-notebook";

  function render() {
    const keywords = keywordManager.all();
    if (keywords.length === 0) {
      root.innerHTML = `<p class="notebook-empty">尚未收集任何关键词。在对话中点击高亮词汇即可收集。</p>`;
      return;
    }

    const groups = groupKeywords(keywords, settingsManager.notebookSortMode);

    root.innerHTML = "";
    groups.forEach(({ title, list }) => {
      const section = document.createElement("div");
      section.className = "notebook-section";
      section.innerHTML = `<h4>${title}</h4>`;
      const ul = document.createElement("ul");
      list.forEach((kw) => {
        const li = document.createElement("li");
        li.className = "notebook-item";
        li.title = `双击在 ChatGTP 中查询「${kw.label}」`;
        li.addEventListener("dblclick", () => launchChatGTPApp({ presetKeywordId: kw.id }));

        const text = document.createElement("span");
        text.className = "notebook-item-text";
        text.innerHTML = `<strong>${kw.label}</strong> <em>(${kw.source || "未知来源"})</em>`;

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "win95-btn bevel-out notebook-delete-btn";
        deleteBtn.textContent = "删除";
        deleteBtn.title = `从笔记本中删除「${kw.label}」`;
        deleteBtn.addEventListener("click", () => keywordManager.remove(kw.id));

        li.appendChild(text);
        li.appendChild(deleteBtn);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      root.appendChild(section);
    });
  }

  const offKeywordChange = keywordManager.onChange(render);
  const offSettingsChange = settingsManager.onChange(render);
  render();

  return windowManager.createWindow({
    appId: "notebook",
    title: "关键词笔记本",
    icon: "📓",
    width: 420,
    height: 480,
    content: root,
    onClose: () => {
      offKeywordChange();
      offSettingsChange();
    },
  });
}
