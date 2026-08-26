import { windowManager } from "./core/WindowManager.js";
import { dayNightSystem } from "./core/DayNightSystem.js";
import { settingsManager } from "./core/SettingsManager.js";
import { audioManager } from "./core/AudioManager.js";
import { confirmDialog } from "./core/ConfirmDialog.js";
import { itemManager } from "./core/ItemManager.js";
import { saveManager } from "./core/SaveManager.js";
import Desktop from "./desktop/Desktop.js";
import Taskbar from "./desktop/Taskbar.js";
import NotificationBanner from "./desktop/NotificationBanner.js";
import { launchHISApp } from "./apps/HISApp.js";
import { launchSocialApp } from "./apps/SocialApp.js";
import { launchChatGTPApp } from "./apps/ChatGTPApp.js";
import { launchNotebookApp } from "./apps/NotebookApp.js";
import { launchStatusApp } from "./apps/StatusApp.js";
import { launchSettingsApp } from "./apps/SettingsApp.js";

/**
 * main.js - application bootstrap. Registers every app with a shared
 * descriptor (id/label/icon/launch) consumed by both the Desktop icon grid
 * and the Start menu, then wires up the WindowManager + Taskbar + Desktop.
 *
 * All apps are always visible on the desktop and in the Start menu, and are
 * always launchable regardless of the current day/night phase. HIS and the
 * Social app instead vary *what content* they show based on the current
 * day + phase (see their own data-driven schedules).
 */

/** Perform the 下班/睡觉 phase-change action, with optional confirmation. */
async function handlePhaseToggle() {
  const isDay = dayNightSystem.phase === "day";
  const message = isDay
    ? "确定要下班，结束白天进入夜晚吗？"
    : "确定要睡觉，结束今天进入下一天吗？";
  if (settingsManager.confirmPhaseChange) {
    const ok = await confirmDialog(message, { title: isDay ? "下班确认" : "睡觉确认", icon: isDay ? "🚪" : "🛏️" });
    if (!ok) return;
  }
  dayNightSystem.toggle();
}

const APP_REGISTRY = [
  { id: "his", label: "HIS 医疗系统", icon: "🏥", launch: () => launchHISApp() },
  { id: "social", label: "夜聊 Messenger", icon: "💬", launch: () => launchSocialApp() },
  { id: "chatgtp", label: "ChatGTP", icon: "🤖", launch: () => launchChatGTPApp() },
  { id: "notebook", label: "关键词笔记本", icon: "📓", launch: () => launchNotebookApp() },
  { id: "status", label: "状态与属性", icon: "📊", launch: () => launchStatusApp() },
  { id: "settings", label: "设置", icon: "⚙️", launch: () => launchSettingsApp() },
  {
    id: "phase-toggle",
    label: () => (dayNightSystem.phase === "day" ? "下班" : "睡觉"),
    icon: () => (dayNightSystem.phase === "day" ? "🚪" : "🛏️"),
    launch: () => handlePhaseToggle(),
  },
];

function boot() {
  const windowLayer = document.getElementById("window-layer");
  windowManager.mount(windowLayer);
  audioManager.mount();

  new Desktop(document.getElementById("desktop-icons"), APP_REGISTRY);

  new Taskbar({
    tasksEl: document.getElementById("taskbar-tasks"),
    clockEl: document.getElementById("taskbar-clock"),
    indicatorEl: document.getElementById("daynight-indicator"),
    startButtonEl: document.getElementById("start-button"),
    startMenuEl: document.getElementById("start-menu"),
    apps: APP_REGISTRY,
  });

  new NotificationBanner(document.getElementById("notification-banner"));

  // Prevent the start menu button click from immediately closing itself
  // via the document-level "click to close" handler.
  document.getElementById("start-button").addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Register launchers so SaveManager can reopen windows that were open at
  // save time, then restore from `location.search` if a save is present.
  const launcherMap = {};
  APP_REGISTRY.forEach((app) => {
    if (app.id !== "phase-toggle") launcherMap[app.id] = () => app.launch();
  });
  saveManager.registerLaunchers(launcherMap);
  saveManager.loadFromLocation();

  console.info(
    `[Cultists OS] Boot complete. Current phase: ${dayNightSystem.phase}, day ${dayNightSystem.day}.`
  );
}

document.addEventListener("DOMContentLoaded", () => {
  // Preload item defs + the canonical index tables SaveManager needs before
  // any UI is shown, so a save-string restore (if present) is deterministic.
  Promise.all([itemManager.load(), saveManager.init()])
    .catch((err) => console.error("[Cultists OS] Failed to preload data:", err))
    .finally(boot);
});
