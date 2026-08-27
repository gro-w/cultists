/**
 * DataLoader - asynchronously loads and caches the game's external data
 * files (JSON) from the `data/` directory. Keeping all content data-driven
 * lets designers edit dialogue/medicine/QA content without touching code.
 */
class DataLoader {
  constructor() {
    this._cache = new Map();
    this._language = "zh-hans";
    this._basePath = `data/${this._language}/`;
  }

  /** Switch the language-scoped content folder (e.g. "zh-hans" -> `data/zh-hans/`). */
  setLanguage(lang) {
    if (!lang || lang === this._language) return;
    this._language = lang;
    this._basePath = `data/${lang}/`;
    this.clearCache();
  }

  get language() {
    return this._language;
  }

  /**
   * Fetch a JSON file from the language-scoped data directory (cached after
   * first load).
   * @param {string} filename e.g. "day01a.json"
   * @returns {Promise<any>}
   */
  async loadJSON(filename) {
    if (this._cache.has(filename)) {
      return this._cache.get(filename);
    }
    const url = `${this._basePath}${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`[DataLoader] Failed to load ${url}: ${response.status}`);
    }
    const data = await response.json();
    this._cache.set(filename, data);
    return data;
  }

  /** Load several files in parallel; returns a keyed object. */
  async loadAll(fileMap) {
    const entries = Object.entries(fileMap);
    const results = await Promise.all(
      entries.map(([, filename]) => this.loadJSON(filename))
    );
    const out = {};
    entries.forEach(([key], idx) => {
      out[key] = results[idx];
    });
    return out;
  }

  clearCache(filename) {
    if (filename) this._cache.delete(filename);
    else this._cache.clear();
  }
}

export const dataLoader = new DataLoader();
export default DataLoader;
