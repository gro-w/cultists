import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";

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
    /**
     * Global registry of every keyword definition seen so far, keyed by id.
     * Lets any app (e.g. ChatGTP answers) highlight/collect a keyword even
     * if it wasn't part of the text's local `keywordDefs` map.
     * @type {Map<string, object>}
     */
    this.definitions = new Map();
  }

  /**
   * Register one or more keyword definitions into the global registry.
   * @param {object|object[]|Record<string, object>} defs
   */
  registerDefinitions(defs) {
    if (!defs) return;
    const list = Array.isArray(defs) ? defs : Object.values(defs);
    list.forEach((def) => {
      if (def && def.id) this.definitions.set(def.id, def);
    });
  }

  /** Look up a definition, preferring a text-local map, then the registry. */
  _resolveDefinition(id, localDefs) {
    return (localDefs && localDefs[id]) || this.definitions.get(id);
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
      const def = this._resolveDefinition(id, keywordDefs);
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
        const def = this._resolveDefinition(id, keywordDefs);
        if (def) {
          this.collect(def);
          span.classList.add("keyword-collected");
        }
      });
    });
  }

  /**
   * Add a keyword to the global notebook (idempotent) and broadcast it.
   * Records the in-game day it was (re-)collected on, used by the
   * Notebook app's "按收集时间第 x 天" grouping mode.
   * @param {object} keyword
   */
  collect(keyword) {
    if (!keyword || !keyword.id) return;
    this.registerDefinitions([keyword]);
    const isNew = !this.collected.has(keyword.id);
    const stored = isNew ? { ...keyword, collectedDay: gameState.day } : this.collected.get(keyword.id);
    this.collected.set(keyword.id, stored);
    eventBus.emit("keyword:collected", { keyword: stored, isNew });
    if (isNew) {
      eventBus.emit("keyword:new", { keyword: stored });
    }
  }

  /**
   * Remove a keyword from the collected notebook (does not forget its
   * definition, so it can still be highlighted/re-collected later).
   * @param {string} id
   */
  remove(id) {
    if (!this.collected.has(id)) return;
    const keyword = this.collected.get(id);
    this.collected.delete(id);
    eventBus.emit("keyword:removed", { id, keyword });
  }

  /**
   * Replace the entire collected notebook (used by SaveManager when
   * restoring a save). Requires the referenced ids to already have a
   * definition registered (SaveManager preloads/registers every known
   * keyword definition at boot for this purpose).
   * @param {{id:string, collectedDay:number}[]} entries
   */
  restoreCollected(entries) {
    this.collected = new Map();
    (entries || []).forEach(({ id, collectedDay }) => {
      const def = this.definitions.get(id);
      if (!def) return;
      this.collected.set(id, { ...def, collectedDay });
    });
    eventBus.emit("keyword:collected", { keyword: null, isNew: false, bulk: true });
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

  /** Subscribe to any change (collect or remove) in the keyword notebook. */
  onChange(handler) {
    const offCollected = eventBus.on("keyword:collected", handler);
    const offRemoved = eventBus.on("keyword:removed", handler);
    return () => {
      offCollected();
      offRemoved();
    };
  }
}

export const keywordManager = new KeywordManager();
export default KeywordManager;
