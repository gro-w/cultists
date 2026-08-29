import { windowManager } from "../core/WindowManager.js";
import { keywordManager } from "../core/KeywordManager.js";
import { settingsManager, NOTEBOOK_SORT_MODES } from "../core/SettingsManager.js";
import { getPinyinInitial } from "../core/Pinyin.js";
import { i18n } from "../core/I18n.js";
import { launchChatGTPApp } from "./ChatGTPApp.js";
import { spellManager } from "../core/SpellManager.js";

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
      const initial = getPinyinInitial(kw.content || kw.label || kw.id);
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

  // ── Tab state ─────────────────────────────────────────────────────────────
  let activeTab = "keywords"; // "keywords" | "spells"

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabBar = document.createElement("div");
  tabBar.style.cssText = "display:flex;gap:0;border-bottom:1px solid #bbb;flex-shrink:0;margin-bottom:8px;";

  function makeTabBtn(id, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn";
    btn.style.cssText = "border-radius:3px 3px 0 0;border-bottom:none;margin-bottom:-1px;padding:4px 14px;";
    btn.textContent = label;
    btn.addEventListener("click", () => { activeTab = id; render(); });
    return btn;
  }

  const kwTabBtn    = makeTabBtn("keywords", "🔑 关键词");
  const spellTabBtn = makeTabBtn("spells",   "✨ 法术");
  tabBar.appendChild(kwTabBtn);
  tabBar.appendChild(spellTabBtn);
  root.appendChild(tabBar);

  const contentEl = document.createElement("div");
  contentEl.style.cssText = "flex:1;overflow-y:auto;";
  root.appendChild(contentEl);

  // ── Keyword panel ─────────────────────────────────────────────────────────
  function renderKeywords() {
    const keywords = keywordManager.all();
    if (keywords.length === 0) {
      contentEl.innerHTML = `<p class="notebook-empty">${i18n.t("notebook.empty", "尚未收集任何关键词。在对话中点击高亮词汇即可收集。")}</p>`;
      return;
    }
    const groups = groupKeywords(keywords, settingsManager.notebookSortMode);
    contentEl.innerHTML = "";
    groups.forEach(({ title, list }) => {
      const section = document.createElement("div");
      section.className = "notebook-section";
      section.innerHTML = `<h4>${title}</h4>`;
      const ul = document.createElement("ul");
      list.forEach((kw) => {
        const content = kw.content || kw.label || kw.id;
        const li = document.createElement("li");
        li.className = "notebook-item";
        li.title = `${i18n.t("notebook.dblClickHint", "双击在 ChatGTP 中查询")}「${content}」`;
        li.addEventListener("dblclick", () => launchChatGTPApp({ presetKeywordId: kw.id }));

        const text = document.createElement("span");
        text.className = "notebook-item-text";
        text.innerHTML = `<strong>${content}</strong> <em>(${kw.source || i18n.t("notebook.unknownSource", "未知来源")})</em>`;

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "win95-btn bevel-out notebook-delete-btn";
        deleteBtn.textContent = i18n.t("notebook.deleteBtn", "删除");
        deleteBtn.title = `${i18n.t("notebook.deleteHint", "从笔记本中删除")}「${content}」`;
        deleteBtn.addEventListener("click", () => keywordManager.remove(kw.id));

        li.appendChild(text);
        li.appendChild(deleteBtn);
        ul.appendChild(li);
      });
      section.appendChild(ul);
      contentEl.appendChild(section);
    });
  }

  // ── Spell panel ───────────────────────────────────────────────────────────
  function renderSpells() {
    const spells = spellManager.all();
    if (spells.length === 0) {
      contentEl.innerHTML = `<p class="notebook-empty" style="padding:24px 16px">` +
        `尚未学习任何法术。<br><small style="color:#aaa">在 0&lt;SAN≤50 时使用可学习的书籍即可开始学习。</small></p>`;
      return;
    }
    contentEl.innerHTML = "";
    const note = document.createElement("p");
    note.style.cssText = "font-size:11px;color:#888;margin:0 0 10px;";
    note.textContent = "施放消耗 5 SAN。施放通过主要日程执行，不额外消耗普通行动时间。";
    contentEl.appendChild(note);

    spells.forEach((spell) => {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #b0bec5;border-radius:4px;padding:10px 12px;margin-bottom:10px;" +
        "background:#e8f5e9;display:flex;flex-direction:column;gap:6px;";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;gap:8px;";
      const title = document.createElement("strong");
      title.style.cssText = "font-size:13px;color:#2e7d32;flex:1;";
      title.textContent = spell.name;
      const src = document.createElement("span");
      src.style.cssText = "font-size:11px;color:#999;";
      src.textContent = `来自《${spell.sourceBookName || spell.sourceBookId}》`;
      header.appendChild(title);
      header.appendChild(src);

      const desc = document.createElement("p");
      desc.style.cssText = "margin:0;font-size:12px;color:#444;line-height:1.5;";
      desc.textContent = spell.description || "（无效果描述）";

      const footer = document.createElement("div");
      footer.style.cssText = "display:flex;align-items:center;gap:8px;";
      const meta = document.createElement("span");
      meta.style.cssText = "font-size:11px;color:#888;flex:1;";
      meta.textContent = `⏱ 学习 4h · 💀 施放 5 SAN`;
      const castBtn = document.createElement("button");
      castBtn.type = "button";
      castBtn.className = "win95-btn bevel-out";
      castBtn.textContent = "施放";
      castBtn.addEventListener("click", () => {
        const res = spellManager.cast(spell.id);
        meta.textContent = res.message;
        setTimeout(() => { meta.textContent = "⏱ 学习 4h · 💀 施放 5 SAN"; }, 2500);
      });

      footer.appendChild(meta);
      footer.appendChild(castBtn);
      card.appendChild(header);
      card.appendChild(desc);
      card.appendChild(footer);
      contentEl.appendChild(card);
    });
  }

  // ── Unified render ────────────────────────────────────────────────────────
  function render() {
    kwTabBtn.style.background    = activeTab === "keywords" ? "#fff" : "";
    kwTabBtn.style.fontWeight    = activeTab === "keywords" ? "700"  : "";
    spellTabBtn.style.background = activeTab === "spells"   ? "#fff" : "";
    spellTabBtn.style.fontWeight = activeTab === "spells"   ? "700"  : "";
    if (activeTab === "spells") renderSpells();
    else renderKeywords();
  }

  const offKeywordChange = keywordManager.onChange(render);
  const offSettingsChange = settingsManager.onChange(render);
  const offSpellChange = spellManager.onChange(render);
  render();

  return windowManager.createWindow({
    appId: "notebook",
    title: i18n.t("apps.notebook", "关键词笔记本"),
    icon: "📓",
    width: 420,
    height: 500,
    content: root,
    onClose: () => {
      offKeywordChange();
      offSettingsChange();
      offSpellChange();
    },
  });
}
