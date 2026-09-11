/**
 * I18n - minimal internationalization helper.
 *
 * UI "chrome" strings (menus, buttons, toasts - anything not authored as
 * game content) live in `data/strings.<lang>.json` at the root of `data/`,
 * e.g. `data/strings.zh_hans.json`. Game *content* (dialogue, items,
 * medicines, endings, ...) instead lives under a per-language folder,
 * e.g. `data/zh-hans/*.json` (see DataLoader.setLanguage).
 *
 * `data/languages.json` lists every available language + the default, so
 * a language picker (Settings app) can be built without hardcoding options.
 */
class I18n {
  constructor() {
    this.language = "zh-hans";
    this.strings = {};
    this.available = [{ code: "zh-hans", label: "简体中文" }];
    this._loaded = false;
  }

  /** Fetch `data/languages.json` (idempotent). */
  async loadLanguages() {
    if (this._languagesLoaded) return this.available;
    const res = await fetch("data/languages.json");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.languages) && data.languages.length > 0) {
        this.available = data.languages;
      }
    }
    this._languagesLoaded = true;
    return this.available;
  }

  /**
   * Load the UI string table for a given language (e.g. "zh-hans" ->
   * `data/strings.zh_hans.json`). Safe to call again to switch language.
   */
  async setLanguage(lang) {
    const code = lang || this.language;
    const fileName = `data/strings.${code.replace(/-/g, "_")}.json`;
    const res = await fetch(fileName);
    if (!res.ok) {
      throw new Error(`[I18n] Failed to load ${fileName}: ${res.status}`);
    }
    this.strings = await res.json();
    this.language = code;
    this._loaded = true;
  }

  /** Look up a string by dotted key; falls back to the key itself (or `fallback`) if missing. */
  t(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(this.strings, key)) {
      return this.strings[key];
    }
    return fallback !== undefined ? fallback : key;
  }
}

export const i18n = new I18n();
export default I18n;
