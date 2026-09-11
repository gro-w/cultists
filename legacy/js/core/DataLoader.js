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
    // DEV-TOOLS:START
    // When the dev server is running, read through its API so edits written
    // via POST /api/file are immediately reflected on the next loadJSON call
    // (the dev panel calls clearCache(filename) before reloading).
    if (DataLoader._devServerOrigin) {
      const apiUrl = `${DataLoader._devServerOrigin}/api/file?f=${encodeURIComponent(filename)}`;
      // cache: "no-store" bypasses the browser HTTP cache so a re-read after
      // writeJSONToDisk always returns the freshly written file, not a stale
      // cached response.
      const response = await fetch(apiUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`[DataLoader] Dev-server failed to load ${filename}: ${response.status}`);
      }
      const data = await response.json();
      this._cache.set(filename, data);
      return data;
    }
    // DEV-TOOLS:END
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

// DEV-TOOLS:START
/**
 * Static property set to the dev-server origin (e.g. "http://localhost:8000")
 * when the /api/files probe succeeds at startup.  Null in production (or when
 * the dev server is not running).  DeveloperMode.js sets this via the exported
 * helper below; nothing outside DEV-TOOLS blocks should read it.
 */
DataLoader._devServerOrigin = null;

/**
 * Probe for a running dev-server and, if found, enable disk-backed reads.
 * Called once from DeveloperMode.js during dev-mode boot.
 * Returns true when the server was detected, false otherwise.
 */
export async function detectDevServer() {
  const origin = window.location.origin;
  try {
    const r = await fetch(`${origin}/api/files`, { cache: "no-store" });
    if (r.ok) {
      DataLoader._devServerOrigin = origin;
      console.info(`[DataLoader] Dev server detected at ${origin} — reads go through /api/file`);
      return true;
    }
  } catch (_) {
    // dev server not running — silently fall back to direct fetch
  }
  return false;
}

/**
 * Write a JSON value to disk via the dev-server API.
 * Throws if the server is not detected or the write fails.
 * Also clears the DataLoader cache for that file so the next loadJSON
 * call returns the freshly written content.
 * @param {string} filename  e.g. "keywords.json"
 * @param {any}    value     JSON-serialisable value
 */
export async function writeJSONToDisk(filename, value) {
  if (!DataLoader._devServerOrigin) {
    throw new Error("Dev server not detected — cannot write to disk.");
  }
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const r = await fetch(
    `${DataLoader._devServerOrigin}/api/file?f=${encodeURIComponent(filename)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  // Invalidate the cache so the next loadJSON call re-reads from disk
  dataLoader.clearCache(filename);
}
// DEV-TOOLS:END

export const dataLoader = new DataLoader();
export default DataLoader;
