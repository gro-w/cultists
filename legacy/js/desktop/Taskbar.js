import { windowManager } from "../core/WindowManager.js";
import { eventBus } from "../core/EventBus.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { i18n } from "../core/I18n.js";
import { gameState } from "../core/GameState.js";
import { timeService } from "../core/TimeService.js";

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
    eventBus.on("time:changed", () => this._tickClock());
    eventBus.on("gamestate:changed", () => this._bindDayNightUpdate());
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
    const locations = new Set(["hospital", "restaurant", "seaside"]);
    const phaseToggle = this.apps.find((app) => app.id === "phase-toggle");
    const groups = [
      ["应用", this.apps.filter((app) => app.id !== "phase-toggle" && !locations.has(app.id))],
      ["地点", this.apps.filter((app) => locations.has(app.id))],
    ];
    const addGroup = (title, apps) => {
      if (!apps.length) return;
      const heading = document.createElement("div");
      heading.className = "start-menu-group-title";
      heading.textContent = title;
      this.startMenuEl.appendChild(heading);
      apps.forEach((app) => this._appendStartMenuItem(app));
    };
    groups.forEach(([title, apps]) => addGroup(title, apps));
    if (phaseToggle) {
      const separator = document.createElement("div");
      separator.className = "start-menu-separator";
      this.startMenuEl.appendChild(separator);
      const item = this._appendStartMenuItem(phaseToggle);
      item.classList.add("start-menu-phase-item");
    }
  }

  _appendStartMenuItem(app) {
    const label = typeof app.label === "function" ? app.label() : app.label;
    const icon = typeof app.icon === "function" ? app.icon() : app.icon;
    const item = document.createElement("div");
    item.className = "start-menu-item";
    item.dataset.appId = app.id;
    item.innerHTML = `<span class="start-menu-item-icon">${icon}</span><span>${label}</span>`;
    item.addEventListener("click", () => {
      app.launch();
      this.startMenuEl.classList.add("hidden");
    });
    this.startMenuEl.appendChild(item);
    return item;
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
    this._bindDayNightUpdate();
  }

  _bindDayNightUpdate() {
    const isDay = dayNightSystem.isDaylight();
    this.indicatorEl.textContent = isDay
      ? `${i18n.t("daynight.day", "☀ 白天")} (Day ${gameState.day})`
      : `${i18n.t("daynight.night", "🌙 夜晚")} (Day ${gameState.day})`;
  }

  _tickClock() {
    const phaseStart = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    const phaseMinutes = timeService.snapshot().phaseMinutes || 0;
    const totalMinutes = (phaseStart + phaseMinutes) % (24 * 60);
    const isEarlyMorning = totalMinutes < 7 * 60 + 40;
    this.clockEl.classList.toggle("early-morning-warning", isEarlyMorning);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    this.clockEl.textContent = `${hh}:${mm}`;
  }
}
