import { windowManager } from "./core/WindowManager.js";
import { dayNightSystem } from "./core/DayNightSystem.js";
import Desktop from "./desktop/Desktop.js";
import Taskbar from "./desktop/Taskbar.js";
import { launchHISApp } from "./apps/HISApp.js";
import { launchSocialApp } from "./apps/SocialApp.js";
import { launchChatGTPApp } from "./apps/ChatGTPApp.js";
import { launchNotebookApp } from "./apps/NotebookApp.js";
import { launchStatusApp } from "./apps/StatusApp.js";

/**
 * main.js - application bootstrap. Registers every app with a shared
 * descriptor (id/label/icon/launch) consumed by both the Desktop icon grid
 * and the Start menu, then wires up the WindowManager + Taskbar + Desktop.
 */

const APP_REGISTRY = [
  { id: "his", label: "HIS 医疗系统", icon: "🏥", launch: () => launchHISApp() },
  { id: "social", label: "夜聊 Messenger", icon: "💬", launch: () => launchSocialApp() },
  { id: "chatgtp", label: "ChatGTP", icon: "🤖", launch: () => launchChatGTPApp() },
  { id: "notebook", label: "关键词笔记本", icon: "📓", launch: () => launchNotebookApp() },
  { id: "status", label: "状态显示器", icon: "📊", launch: () => launchStatusApp() },
];

function boot() {
  const windowLayer = document.getElementById("window-layer");
  windowManager.mount(windowLayer);

  new Desktop(document.getElementById("desktop-icons"), APP_REGISTRY);

  new Taskbar({
    tasksEl: document.getElementById("taskbar-tasks"),
    clockEl: document.getElementById("taskbar-clock"),
    indicatorEl: document.getElementById("daynight-indicator"),
    startButtonEl: document.getElementById("start-button"),
    startMenuEl: document.getElementById("start-menu"),
    apps: APP_REGISTRY,
  });

  // Prevent the start menu button click from immediately closing itself
  // via the document-level "click to close" handler.
  document.getElementById("start-button").addEventListener("click", (e) => {
    e.stopPropagation();
  });

  console.info(
    `[Cultists OS] Boot complete. Current phase: ${dayNightSystem.phase}, day ${dayNightSystem.day}.`
  );
}

document.addEventListener("DOMContentLoaded", boot);
