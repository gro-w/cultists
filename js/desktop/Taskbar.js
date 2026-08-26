import { windowManager } from "../core/WindowManager.js";
import { eventBus } from "../core/EventBus.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { gameState } from "../core/GameState.js";

/**
 * Taskbar - shows open window tabs, a live clock, current day/night
 * indicator and the Start menu (with a manual day/night toggle for testing
 * and an app launcher list).
 */
export default class Taskbar {
  constructor({ tasksEl, clockEl, indicatorEl, startButtonEl, startMenuEl, apps }) {
    this.tasksEl = tasksEl;
    this.clockEl = clockEl;
    this.indicatorEl = indicatorEl;
    this.startButtonEl = startButtonEl;
    this.startMenuEl = startMenuEl;
    this.apps = apps;

    this._renderStartMenu();
    this._bindStartButton();
    this._bindWindowEvents();
    this._bindDayNight();
    this._tickClock();
    setInterval(() => this._tickClock(), 1000 * 30);
  }

  _bindStartButton() {
    this.startButtonEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startMenuEl.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
      this.startMenuEl.classList.add("hidden");
    });
  }

  _renderStartMenu() {
    this.startMenuEl.innerHTML = "";
    this.apps.forEach((app) => {
      const item = document.createElement("div");
      item.className = "start-menu-item";
      item.innerHTML = `<span>${app.icon}</span><span>${app.label}</span>`;
      item.addEventListener("click", () => {
        app.launch();
        this.startMenuEl.classList.add("hidden");
      });
      this.startMenuEl.appendChild(item);
    });

    const toggleItem = document.createElement("div");
    toggleItem.className = "start-menu-item";
    toggleItem.innerHTML = `<span>🌓</span><span>切换昼夜（测试用）</span>`;
    toggleItem.addEventListener("click", () => {
      dayNightSystem.toggle();
      this.startMenuEl.classList.add("hidden");
    });
    this.startMenuEl.appendChild(toggleItem);
  }

  _bindWindowEvents() {
    const rerender = () => this._renderTasks();
    eventBus.on("window:opened", rerender);
    eventBus.on("window:closed", rerender);
    eventBus.on("window:focused", rerender);
  }

  _renderTasks() {
    this.tasksEl.innerHTML = "";
    windowManager.list().forEach((win) => {
      const task = document.createElement("div");
      task.className = `taskbar-task bevel-out${win.el.classList.contains("focused") ? " active" : ""}`;
      task.innerHTML = `<span>${win.icon}</span><span>${win.title}</span>`;
      task.addEventListener("click", () => windowManager.focus(win.id));
      this.tasksEl.appendChild(task);
    });
  }

  _bindDayNight() {
    const update = () => {
      const isDay = dayNightSystem.phase === "day";
      this.indicatorEl.textContent = isDay
        ? `☀ 白天 (Day ${gameState.day})`
        : `🌙 夜晚 (Day ${gameState.day})`;
    };
    eventBus.on("daynight:changed", update);
    update();
  }

  _tickClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    this.clockEl.textContent = `${hh}:${mm}`;
  }
}
