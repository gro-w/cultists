import { windowManager } from "./core/WindowManager.js";
import { dayNightSystem } from "./core/DayNightSystem.js";
import { settingsManager } from "./core/SettingsManager.js";
import { audioManager } from "./core/AudioManager.js";
import { confirmDialog } from "./core/ConfirmDialog.js";
import { itemManager } from "./core/ItemManager.js";
import { saveManager } from "./core/SaveManager.js";
import { scheduleData } from "./core/ScheduleData.js";
import { endingManager } from "./core/EndingManager.js";
import { i18n } from "./core/I18n.js";
import { dataLoader } from "./core/DataLoader.js";
import { skillManager } from "./core/SkillManager.js";
import { actionBudget } from "./core/ActionBudget.js";
import { npcStateManager } from "./core/NpcStateManager.js";
import { gameState } from "./core/GameState.js";
import { achievementManager } from "./core/AchievementManager.js";
import Desktop from "./desktop/Desktop.js";
import Taskbar from "./desktop/Taskbar.js";
import NotificationBanner from "./desktop/NotificationBanner.js";
import AchievementToast from "./desktop/AchievementToast.js";
import MainMenu from "./desktop/MainMenu.js";
import EndingScreen from "./desktop/EndingScreen.js";
import DormMode from "./desktop/DormMode.js";
import { launchHISApp } from "./apps/HISApp.js";
import { launchSocialApp } from "./apps/SocialApp.js";
import { launchChatGTPApp } from "./apps/ChatGTPApp.js";
import { launchNotebookApp } from "./apps/NotebookApp.js";
import { launchStatusApp } from "./apps/StatusApp.js";
import { launchSettingsApp } from "./apps/SettingsApp.js";
import { launchMonitorApp } from "./apps/MonitorApp.js";
import { launchAchievementsApp } from "./apps/AchievementsApp.js";

/**
 * main.js - application bootstrap. Registers every app with a shared
 * descriptor (id/label/icon/launch) consumed by both the Desktop icon grid
 * and the Start menu, then wires up the WindowManager + Taskbar + Desktop.
 *
 * All apps are always visible on the desktop and in the Start menu, and are
 * always launchable regardless of the current day/night phase. HIS and the
 * Social app instead vary *what content* they show based on the current
 * day + phase (see their own data-driven schedules).
 *
 * Boot flow: if `location.search` is empty, an XP-style Main Menu overlay
 * is shown first (new game / load save-string). If a search string is
 * already present, the game boots straight in and shows a "welcome back"
 * toast instead of the old per-phase "XX 已开启" wording.
 */

/** Perform the 下班/睡觉 phase-change action, with optional confirmation. */
async function handlePhaseToggle() {
  const clockMinutes = dayNightSystem.currentClockMinutes();
  const inWorkWindow = clockMinutes >= 8 * 60 && clockMinutes < 16 * 60;
  const goingToWork = gameState.location === "dorm" && inWorkWindow;
  const isWorkEnd = gameState.location === "work";
  const message = goingToWork
    ? "确定要去上班吗？时间不会推进。"
    : isWorkEnd
      ? i18n.t("phase.workEndMessage", "确定要下班，结束白天进入夜晚吗？")
      : i18n.t("phase.sleepMessage", "确定要睡觉，结束今天进入下一天吗？");
  if (settingsManager.confirmPhaseChange) {
    const title = goingToWork
      ? "去上班确认"
      : isWorkEnd
        ? i18n.t("phase.workEndTitle", "下班确认")
        : i18n.t("phase.sleepTitle", "睡觉确认");
    const ok = await confirmDialog(message, { title, icon: goingToWork || isWorkEnd ? "🚪" : "🛏️" });
    if (!ok) return;
  }
  dayNightSystem.toggle();
}

const APP_REGISTRY = [
  { id: "his", label: () => i18n.t("apps.his", "HIS 医疗系统"), icon: "🏥", launch: () => launchHISApp() },
  { id: "social", label: () => i18n.t("apps.social", "夜聊 Messenger"), icon: "💬", launch: () => launchSocialApp() },
  { id: "monitor", label: () => i18n.t("apps.monitor", "监控画面"), icon: "🖥️", launch: () => launchMonitorApp() },
  { id: "chatgtp", label: () => i18n.t("apps.chatgtp", "ChatGTP"), icon: "🤖", launch: () => launchChatGTPApp() },
  { id: "notebook", label: () => i18n.t("apps.notebook", "关键词笔记本"), icon: "📓", launch: () => launchNotebookApp() },
  { id: "status", label: () => i18n.t("apps.status", "状态与属性"), icon: "📊", launch: () => launchStatusApp() },
  { id: "achievements", label: () => i18n.t("apps.achievements", "成就"), icon: "🏆", launch: () => launchAchievementsApp() },
  { id: "settings", label: () => i18n.t("apps.settings", "设置"), icon: "⚙️", launch: () => launchSettingsApp() },
  {
    id: "phase-toggle",
    label: () =>
      gameState.location === "work"
        ? i18n.t("apps.phaseToggleWork", "下班")
        : dayNightSystem.currentClockMinutes() >= 8 * 60 && dayNightSystem.currentClockMinutes() < 16 * 60
          ? "去上班"
          : "去睡觉",
    icon: () => gameState.location === "work" ? "🚪" : dayNightSystem.currentClockMinutes() >= 8 * 60 && dayNightSystem.currentClockMinutes() < 16 * 60 ? "🚶" : "🛏️",
    launch: () => handlePhaseToggle(),
  },
];

function boot({ welcomeBack }) {
  const windowLayer = document.getElementById("window-layer");
  const workShell = document.getElementById("work-shell");
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

  const notificationBanner = new NotificationBanner(document.getElementById("notification-banner"));
  new EndingScreen(document.getElementById("ending-screen"));
  const dormMode = new DormMode(document.getElementById("dorm-mode"), {
    workShell,
    launchWorkApp: () => {
      if (gameState.location === "dorm") dayNightSystem.toggle();
    },
  });
  dormMode.init().catch((err) => console.error("[Cultists] Failed to initialize dorm mode:", err));

  // Achievement toast – separate element so it doesn't clobber day/night banners.
  const achievementToast = new AchievementToast(document.getElementById("achievement-toast"));
  achievementToast.setLauncher(() => launchAchievementsApp());

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

  if (welcomeBack) {
    saveManager.loadFromLocation();
    notificationBanner.showWelcomeBack();
  }

  console.info(
    `[Cultists] Boot complete. Current phase: ${dayNightSystem.phase}, day ${dayNightSystem.day}.`
  );
}

document.addEventListener("DOMContentLoaded", () => {
  // Preload item/schedule/ending defs + the canonical index tables
  // SaveManager needs before any UI is shown, so a save-string restore (if
  // present) is deterministic. UI strings load first since several of the
  // preloaded modules (Settings, Notebook...) read i18n.t() during render.
  const language = settingsManager.language;
  dataLoader.setLanguage(language);

  Promise.all([
    i18n.setLanguage(language),
    i18n.loadLanguages(),
    itemManager.load(),
    scheduleData.init(),
    endingManager.load(),
    saveManager.init(),
    skillManager.load(),
    actionBudget.init(),
    npcStateManager.load(),
    achievementManager.init(),
  ])
    .catch((err) => console.error("[Cultists] Failed to preload data:", err))
    .finally(() => {
      // The menu is the first visible surface. Boot the desktop underneath it
      // so selecting an entry only changes visibility and cannot race the
      // fairly large app/event-bus initialization step.
      const welcomeBack = Boolean(window.location.search)
        ;
      boot({ welcomeBack });
      const mainMenu = new MainMenu(document.getElementById("main-menu"), {
        onNewGame: () => {
          window.history.replaceState(null, "", window.location.pathname);
        },
        onLoadSave: (saveString) => {
          const ok = saveManager.loadFromString(saveString);
          return ok;
        },
      });
      if (welcomeBack) mainMenu.hide();
      else {
        mainMenu.show();
      }
    });
});
