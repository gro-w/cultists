import { endingManager } from "../core/EndingManager.js";
import { i18n } from "../core/I18n.js";

/**
 * EndingScreen - full-page overlay shown when EndingManager fires any
 * ending (event/item/stat/time-triggered). Displays the ending's icon,
 * title and text, with a single "返回主菜单" action that reloads the page
 * without a search string, dropping the player back at the Main Menu for
 * a fresh run.
 */
export default class EndingScreen {
  /** @param {HTMLElement} rootEl - container element (e.g. #ending-screen) */
  constructor(rootEl) {
    this.rootEl = rootEl;
    endingManager.onEnding((def) => this.show(def));
    endingManager.onReset(() => this.hide());
  }

  show(def) {
    this.rootEl.innerHTML = `
      <div class="crt-screen">
        <div class="ending-screen-panel">
          <div class="ending-screen-icon">${def.icon || "🌑"}</div>
          <h2 class="ending-screen-title">${def.title || ""}</h2>
          <p class="ending-screen-text">${def.text || ""}</p>
          <button type="button" class="crt-btn ending-screen-btn">
            ${i18n.t("ending.backToMenu", "返回主菜单")}
          </button>
        </div>
      </div>
    `;
    this.rootEl.classList.remove("hidden");
    this.rootEl.querySelector(".ending-screen-btn").addEventListener("click", () => {
      window.location.href = window.location.pathname;
    });
  }

  hide() {
    this.rootEl.classList.add("hidden");
    this.rootEl.replaceChildren();
  }
}
