import { windowManager } from "../core/WindowManager.js";
import { eventBus } from "../core/EventBus.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { i18n } from "../core/I18n.js";
import { gameState } from "../core/GameState.js";

/**
 * Taskbar - shows open window tabs, a live clock, current day/night
 * indicator and the Start menu (listing every registered app).
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
    eventBus.on("daynight:changed", () => this._renderStartMenu());
    eventBus.on("daynight:changed", () => this._tickClock());
    eventBus.on("actionBudget:changed", () => this._tickClock());
    this._tickClock();
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
      const label = typeof app.label === "function" ? app.label() : app.label;
      const icon = typeof app.icon === "function" ? app.icon() : app.icon;
      const item = document.createElement("div");
      item.className = "start-menu-item";
      item.innerHTML = `<span>${icon}</span><span>${label}</span>`;
      item.addEventListener("click", () => {
        app.launch();
        this.startMenuEl.classList.add("hidden");
      });
      this.startMenuEl.appendChild(item);
    });
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
        ? `${i18n.t("daynight.day", "☀ 白天")} (Day ${gameState.day})`
        : `${i18n.t("daynight.night", "🌙 夜晚")} (Day ${gameState.day})`;
    };
    eventBus.on("daynight:changed", update);
    update();
  }

  _tickClock() {
    const phaseStart = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    const phaseDuration = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    const phaseMinutes = Math.min(actionBudget.snapshot().phaseMinutes || 0, phaseDuration);
    const totalMinutes = (phaseStart + phaseMinutes) % (24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    this.clockEl.textContent = `${hh}:${mm}`;
  }
}
