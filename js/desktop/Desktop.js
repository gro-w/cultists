import { dayNightSystem } from "../core/DayNightSystem.js";
import { eventBus } from "../core/EventBus.js";

/**
 * Desktop - renders the desktop icons and launches the corresponding app
 * when double/single-clicked. Icon visibility respects the current
 * day/night phase (e.g. HIS only shown during the day).
 */
export default class Desktop {
  /**
   * @param {HTMLElement} containerEl
   * @param {Array<{id:string,label:string,icon:string,launch:()=>void}>} apps
   */
  constructor(containerEl, apps) {
    this.containerEl = containerEl;
    this.apps = apps;
    this._render();
    eventBus.on("daynight:changed", () => this._render());
  }

  _render() {
    this.containerEl.innerHTML = "";
    this.apps
      .filter((app) => dayNightSystem.isAppAvailable(app.id))
      .forEach((app) => {
        const iconEl = document.createElement("div");
        iconEl.className = "desktop-icon";
        iconEl.tabIndex = 0;
        iconEl.innerHTML = `
          <span class="icon-glyph">${app.icon}</span>
          <span class="icon-label">${app.label}</span>
        `;
        iconEl.addEventListener("dblclick", () => app.launch());
        iconEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") app.launch();
        });
        this.containerEl.appendChild(iconEl);
      });
  }
}
