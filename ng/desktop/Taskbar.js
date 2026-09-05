/**
 * Taskbar - renders task buttons for every open window and a clock. Reads
 * window state from WindowManager only; never mutates it directly except
 * through the manager's own methods (focus/toggleMinimize).
 */
export class Taskbar {
  constructor(windowManager, eventBus, rootEl) {
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.rootEl = rootEl;
    this._unsubscribers = [];
    this._buildDom();
    this._bindEvents();
    this.render();
  }

  _buildDom() {
    this.rootEl.innerHTML = `
      <button type="button" class="start-button bevel-out">
        <span class="start-icon">🗔</span><span>开始</span>
      </button>
      <div class="taskbar-tasks"></div>
      <div class="taskbar-status">
        <span class="taskbar-clock"></span>
      </div>
    `;
    this.tasksEl = this.rootEl.querySelector(".taskbar-tasks");
    this.clockEl = this.rootEl.querySelector(".taskbar-clock");
  }

  _bindEvents() {
    ["window:opened", "window:closed", "window:focused", "window:minimized", "window:restored"].forEach((name) => {
      this._unsubscribers.push(this.eventBus.on(name, () => this.render()));
    });
  }

  render() {
    const windows = this.windowManager.list();
    const focusedId = this.windowManager.focusedInstanceId();
    this.tasksEl.innerHTML = "";
    for (const state of windows) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "taskbar-task bevel-out";
      button.classList.toggle("active", state.instanceId === focusedId && !state.minimized);
      const iconSpan = document.createElement("span");
      iconSpan.className = "taskbar-task-icon";
      iconSpan.textContent = state.icon || "🗔";
      const titleSpan = document.createElement("span");
      titleSpan.className = "taskbar-task-title";
      titleSpan.textContent = state.title;
      button.append(iconSpan, titleSpan);
      button.addEventListener("click", () => {
        if (state.minimized || state.instanceId !== focusedId) {
          this.windowManager.restore(state.instanceId);
          this.windowManager.focus(state.instanceId);
        } else {
          this.windowManager.minimize(state.instanceId);
        }
      });
      this.tasksEl.appendChild(button);
    }
  }

  /** Displays engine/game status text; never reads the system clock. */
  setClockText(text) {
    this.clockEl.textContent = text;
  }

  dispose() {
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
    this._unsubscribers = [];
  }
}

export default Taskbar;
