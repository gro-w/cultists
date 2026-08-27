import { windowManager } from "../core/WindowManager.js";
import { settingsManager, NOTEBOOK_SORT_MODES } from "../core/SettingsManager.js";
import { i18n } from "../core/I18n.js";
import { dataLoader } from "../core/DataLoader.js";

const SORT_MODE_LABELS = {
  [NOTEBOOK_SORT_MODES.CATEGORY]: i18n.t("settings.sortCategory", "按类别"),
  [NOTEBOOK_SORT_MODES.DAY]: i18n.t("settings.sortDay", "按收集时间（第 x 天）"),
  [NOTEBOOK_SORT_MODES.PINYIN]: i18n.t("settings.sortPinyin", "按拼音首字母"),
};

/**
 * SettingsApp - lets the player configure:
 *   - BGM 音量 (background music volume, 0-100)
 *   - 笔记本分组排序方式 (Notebook grouping/sort mode)
 *   - 下班/睡觉是否需要二次确认 (whether the phase-change shortcut confirms)
 * Changes are applied immediately via SettingsManager (and persisted).
 */
export async function launchSettingsApp() {
  const root = document.createElement("div");
  root.className = "app-settings";
  root.innerHTML = `
    <div class="settings-section">
      <h4>${i18n.t("settings.bgmVolume", "BGM 音量")}</h4>
      <div class="settings-row">
        <input type="range" class="settings-volume-slider" min="0" max="100" step="1" />
        <span class="settings-volume-value"></span>
      </div>
    </div>
    <div class="settings-section">
      <h4>${i18n.t("settings.notebookSort", "笔记本分组排序方式")}</h4>
      <select class="win95-select settings-sort-select"></select>
    </div>
    <div class="settings-section">
      <label class="settings-checkbox-row">
        <input type="checkbox" class="settings-confirm-checkbox" />
        ${i18n.t("settings.confirmPhase", "下班/睡觉前需要二次确认")}
      </label>
    </div>
    <div class="settings-section">
      <h4>${i18n.t("settings.language", "语言")}</h4>
      <select class="win95-select settings-language-select"></select>
    </div>
  `;

  const volumeSlider = root.querySelector(".settings-volume-slider");
  const volumeValue = root.querySelector(".settings-volume-value");
  const sortSelect = root.querySelector(".settings-sort-select");
  const confirmCheckbox = root.querySelector(".settings-confirm-checkbox");
  const languageSelect = root.querySelector(".settings-language-select");

  const languages = await i18n.loadLanguages();
  languages.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.label;
    languageSelect.appendChild(opt);
  });

  Object.entries(SORT_MODE_LABELS).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sortSelect.appendChild(opt);
  });

  function syncFromSettings() {
    volumeSlider.value = String(settingsManager.bgmVolume);
    volumeValue.textContent = `${settingsManager.bgmVolume}%`;
    sortSelect.value = settingsManager.notebookSortMode;
    confirmCheckbox.checked = settingsManager.confirmPhaseChange;
    languageSelect.value = settingsManager.language;
  }

  volumeSlider.addEventListener("input", () => {
    const bgmVolume = Number(volumeSlider.value);
    volumeValue.textContent = `${bgmVolume}%`;
    settingsManager.set({ bgmVolume });
  });
  sortSelect.addEventListener("change", () => {
    settingsManager.set({ notebookSortMode: sortSelect.value });
  });
  confirmCheckbox.addEventListener("change", () => {
    settingsManager.set({ confirmPhaseChange: confirmCheckbox.checked });
  });
  languageSelect.addEventListener("change", async () => {
    const language = languageSelect.value;
    settingsManager.set({ language });
    dataLoader.setLanguage(language);
    await i18n.setLanguage(language);
    // Full reload keeps every already-rendered app in sync with the new
    // language rather than requiring bespoke re-render logic everywhere.
    window.location.reload();
  });

  const offSettingsChange = settingsManager.onChange(syncFromSettings);
  syncFromSettings();

  return windowManager.createWindow({
    appId: "settings",
    title: i18n.t("apps.settings", "设置"),
    icon: "⚙️",
    width: 360,
    height: 300,
    resizable: false,
    content: root,
    onClose: () => offSettingsChange(),
  });
}
