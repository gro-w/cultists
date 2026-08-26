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
 * by category. Only shows the keyword label and its source (no detailed
 * definition) and lets the player delete a keyword from the notebook.
 * Subscribes to KeywordManager so it always reflects the latest global
 * state.
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
        li.className = "notebook-item";

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
  render();

  return windowManager.createWindow({
    appId: "notebook",
    title: "关键词笔记本",
    icon: "📓",
    width: 420,
    height: 480,
    content: root,
    onClose: () => offKeywordChange(),
  });
}
