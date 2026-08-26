import { eventBus } from "./EventBus.js";

/**
 * KeywordManager - global keyword bus (singleton) implementing a
 * publish/subscribe pattern for the game's core "keyword collection"
 * mechanic:
 *   - renders highlighted keyword spans inside arbitrary dialogue text
 *   - collects keywords into a shared Notebook when clicked
 *   - notifies every subscriber (Notebook, HIS, ChatGTP...) instantly
 *
 * Keyword definition shape (as authored in dialogue JSON / keyword configs):
 *   {
 *     id: "fever",            // unique id
 *     label: "发热",           // displayed text
 *     category: "symptom",    // symptom | item | clue | drug | misc
 *     definition: "体温超过37.3摄氏度的状态。",
 *     source: "病人-王芳"       // where it was collected from
 *   }
 */
class KeywordManager {
  constructor() {
    /** @type {Map<string, object>} collected keywords keyed by id */
    this.collected = new Map();
  }

  /**
   * Render a plain string containing `[[keywordId|display text]]` or
   * `[[keywordId]]` markers into HTML with clickable highlighted spans.
   * @param {string} text
   * @param {Record<string, object>} keywordDefs - map of id -> keyword definition
   * @returns {string} HTML string
   */
  renderHighlightedText(text, keywordDefs = {}) {
    if (!text) return "";
    return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, id, display) => {
      const def = keywordDefs[id];
      const label = display || (def ? def.label : id);
      if (!def) {
        console.warn(`[KeywordManager] Unknown keyword id "${id}" referenced in text.`);
        return label;
      }
      const collectedClass = this.collected.has(id) ? "keyword-collected" : "";
      return `<span class="keyword-highlight ${collectedClass}" data-keyword-id="${id}">${label}</span>`;
    });
  }

  /**
   * Attach click listeners to every `.keyword-highlight` element within a
   * container, wired to collect the associated keyword definition.
   * @param {HTMLElement} container
   * @param {Record<string, object>} keywordDefs
   */
  bindHighlights(container, keywordDefs = {}) {
    container.querySelectorAll(".keyword-highlight").forEach((span) => {
      span.addEventListener("click", () => {
        const id = span.dataset.keywordId;
        const def = keywordDefs[id];
        if (def) {
          this.collect(def);
          span.classList.add("keyword-collected");
        }
      });
    });
  }

  /**
   * Add a keyword to the global notebook (idempotent) and broadcast it.
   * @param {object} keyword
   */
  collect(keyword) {
    if (!keyword || !keyword.id) return;
    const isNew = !this.collected.has(keyword.id);
    this.collected.set(keyword.id, keyword);
    eventBus.emit("keyword:collected", { keyword, isNew });
    if (isNew) {
      eventBus.emit("keyword:new", { keyword });
    }
  }

  has(id) {
    return this.collected.has(id);
  }

  get(id) {
    return this.collected.get(id);
  }

  all() {
    return [...this.collected.values()];
  }

  allByCategory(category) {
    return this.all().filter((k) => k.category === category);
  }

  /** Subscribe to any change in the keyword notebook. */
  onChange(handler) {
    const off1 = eventBus.on("keyword:collected", handler);
    return off1;
  }
}

export const keywordManager = new KeywordManager();
export default KeywordManager;
