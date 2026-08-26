import { eventBus } from "./EventBus.js";

const STORAGE_KEY = "cultists:settings";

/** Valid notebook sort/group modes. */
export const NOTEBOOK_SORT_MODES = {
  CATEGORY: "category", // 按类别分组
  DAY: "day", // 按收集时间第 x 天分组
  PINYIN: "pinyin", // 按拼音首字母分组
};

/**
 * SettingsManager - singleton holding player-configurable preferences:
 *   - bgmVolume: background music volume (0-100)
 *   - notebookSortMode: how the Notebook app groups collected keywords
 *   - confirmPhaseChange: whether clocking off / going to sleep requires
 *     an extra confirmation dialog
 * Settings are persisted to localStorage (best-effort) and broadcast via
 * the shared eventBus so any app can react instantly (Notebook, AudioManager...).
 */
class SettingsManager {
  constructor() {
    this.bgmVolume = 50;
    this.notebookSortMode = NOTEBOOK_SORT_MODES.CATEGORY;
    this.confirmPhaseChange = true;
    this.language = "zh-hans";
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      const { bgmVolume, notebookSortMode, confirmPhaseChange, language } = saved;
      if (typeof bgmVolume === "number") this.bgmVolume = bgmVolume;
      if (typeof notebookSortMode === "string") this.notebookSortMode = notebookSortMode;
      if (typeof confirmPhaseChange === "boolean") this.confirmPhaseChange = confirmPhaseChange;
      if (typeof language === "string") this.language = language;
    } catch (err) {
      console.warn("[SettingsManager] Failed to load saved settings:", err);
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch (err) {
      console.warn("[SettingsManager] Failed to persist settings:", err);
    }
  }

  /**
   * Update one or more settings and broadcast the change. Only known,
   * type-checked keys are applied, to avoid accidentally clobbering
   * internal methods/properties with unexpected input.
   * @param {Partial<{bgmVolume:number, notebookSortMode:string, confirmPhaseChange:boolean, language:string}>} partial
   */
  set(partial = {}) {
    const { bgmVolume, notebookSortMode, confirmPhaseChange, language } = partial;
    if (typeof bgmVolume === "number") this.bgmVolume = bgmVolume;
    if (typeof notebookSortMode === "string") this.notebookSortMode = notebookSortMode;
    if (typeof confirmPhaseChange === "boolean") this.confirmPhaseChange = confirmPhaseChange;
    if (typeof language === "string") this.language = language;
    this._save();
    eventBus.emit("settings:changed", this.snapshot());
  }

  snapshot() {
    return {
      bgmVolume: this.bgmVolume,
      notebookSortMode: this.notebookSortMode,
      confirmPhaseChange: this.confirmPhaseChange,
      language: this.language,
    };
  }

  /** Subscribe to any settings change. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("settings:changed", handler);
  }
}

export const settingsManager = new SettingsManager();
export default SettingsManager;
