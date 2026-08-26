import { eventBus } from "../core/EventBus.js";

/**
 * Desktop - renders the desktop icons and launches the corresponding app
 * when double/single-clicked. Every registered app is always shown on the
 * desktop regardless of day/night phase; apps that are gated to a specific
 * phase (e.g. HIS only during the day) enforce that at launch time instead.
 * `label`/`icon` may be plain strings or zero-arg functions (used by the
 * dynamic 下班/睡觉 phase-toggle shortcut), and are re-evaluated whenever the
 * desktop re-renders.
 */
export default class Desktop {
  /**
   * @param {HTMLElement} containerEl
   * @param {Array<{id:string,label:string|(()=>string),icon:string|(()=>string),launch:()=>void}>} apps
   */
  constructor(containerEl, apps) {
    this.containerEl = containerEl;
    this.apps = apps;
    this._render();
    eventBus.on("daynight:changed", () => this._render());
  }

  _render() {
    this.containerEl.innerHTML = "";
    this.apps.forEach((app) => {
      const label = typeof app.label === "function" ? app.label() : app.label;
      const icon = typeof app.icon === "function" ? app.icon() : app.icon;
      const iconEl = document.createElement("div");
      iconEl.className = "desktop-icon";
      iconEl.tabIndex = 0;
      iconEl.innerHTML = `
        <span class="icon-glyph">${icon}</span>
        <span class="icon-label">${label}</span>
      `;
      iconEl.addEventListener("dblclick", () => app.launch());
      iconEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") app.launch();
      });
      this.containerEl.appendChild(iconEl);
    });
  }
}
