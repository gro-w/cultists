import { windowManager } from "../core/WindowManager.js";
import { keywordManager } from "../core/KeywordManager.js";

const CATEGORY_LABELS = {
  symptom: "症状",
  item: "物品",
  clue: "线索",
  drug: "药品",
  misc: "其他",
};

/**
 * NotebookApp - real-time view of every keyword collected so far, grouped
 * by category, with definition and source. Subscribes to KeywordManager so
 * it always reflects the latest global state.
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

    const groups = {};
    keywords.forEach((kw) => {
      const cat = kw.category || "misc";
      groups[cat] = groups[cat] || [];
      groups[cat].push(kw);
    });

    root.innerHTML = "";
    Object.entries(groups).forEach(([cat, list]) => {
      const section = document.createElement("div");
      section.className = "notebook-section";
      section.innerHTML = `<h4>${CATEGORY_LABELS[cat] || cat}</h4>`;
      const ul = document.createElement("ul");
      list.forEach((kw) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${kw.label}</strong> — ${kw.definition || "暂无释义"} <em>(${
          kw.source || "未知来源"
        })</em>`;
        ul.appendChild(li);
      });
      section.appendChild(ul);
      root.appendChild(section);
    });
  }

  keywordManager.onChange(render);
  render();

  return windowManager.createWindow({
    appId: "notebook",
    title: "关键词笔记本",
    icon: "📓",
    width: 420,
    height: 480,
    content: root,
  });
}
