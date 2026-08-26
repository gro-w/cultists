import { windowManager } from "../core/WindowManager.js";
import { settingsManager, NOTEBOOK_SORT_MODES } from "../core/SettingsManager.js";

const SORT_MODE_LABELS = {
  [NOTEBOOK_SORT_MODES.CATEGORY]: "按类别",
  [NOTEBOOK_SORT_MODES.DAY]: "按收集时间（第 x 天）",
  [NOTEBOOK_SORT_MODES.PINYIN]: "按拼音首字母",
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
      <h4>BGM 音量</h4>
      <div class="settings-row">
        <input type="range" class="settings-volume-slider" min="0" max="100" step="1" />
        <span class="settings-volume-value"></span>
      </div>
    </div>
    <div class="settings-section">
      <h4>笔记本分组排序方式</h4>
      <select class="win95-select settings-sort-select"></select>
    </div>
    <div class="settings-section">
      <label class="settings-checkbox-row">
        <input type="checkbox" class="settings-confirm-checkbox" />
        下班/睡觉前需要二次确认
      </label>
    </div>
  `;

  const volumeSlider = root.querySelector(".settings-volume-slider");
  const volumeValue = root.querySelector(".settings-volume-value");
  const sortSelect = root.querySelector(".settings-sort-select");
  const confirmCheckbox = root.querySelector(".settings-confirm-checkbox");

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

  const offSettingsChange = settingsManager.onChange(syncFromSettings);
  syncFromSettings();

  return windowManager.createWindow({
    appId: "settings",
    title: "设置",
    icon: "⚙️",
    width: 360,
    height: 300,
    resizable: false,
    content: root,
    onClose: () => offSettingsChange(),
  });
}
