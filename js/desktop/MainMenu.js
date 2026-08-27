/**
 * MainMenu - a full-screen, retro-CRT-terminal-styled boot/login screen
 * shown at boot when there is no save string in the URL. Lets the player
 * either start a brand new game or load an existing save by pasting its
 * save string (the `?...` part of a previously-saved URL) as a "password".
 *
 * Deliberately styled differently from the rest of the (Win95) UI - this
 * screen represents the moment before/after the simulated Win95 desktop
 * boots, so it borrows an old-school phosphor-green terminal look (scan
 * lines, glow, blinking cursor) instead of the grey Win95 chrome
 * (see css/mainmenu.css).
 */
import { i18n } from "../core/I18n.js";

export default class MainMenu {
  /**
   * @param {HTMLElement} rootEl - container element (e.g. #main-menu)
   * @param {object} handlers
   * @param {() => void} handlers.onNewGame
   * @param {(saveString: string) => boolean} handlers.onLoadSave - returns whether the load succeeded
   */
  constructor(rootEl, { onNewGame, onLoadSave }) {
    this.rootEl = rootEl;
    this.onNewGame = onNewGame;
    this.onLoadSave = onLoadSave;
    this._render();
  }

  show() {
    this.rootEl.classList.remove("hidden");
  }

  hide() {
    this.rootEl.classList.add("hidden");
  }

  _render() {
    this.rootEl.innerHTML = `
      <div class="crt-screen">
        <div class="crt-title">${i18n.t("mainmenu.title", "完蛋，我被邪教徒包围了！")}<span class="crt-cursor">&nbsp;</span></div>
        <div class="crt-subtitle">${i18n.t("mainmenu.subtitle", "CULTISTS")}</div>
        <div class="crt-menu-list">
          <button type="button" class="crt-menu-item" data-action="new-game">
            <span class="crt-menu-marker">&gt;</span>
            <span class="crt-menu-item-text">
              <span>[1] 新游戏</span>
              <span class="crt-menu-item-hint">开始一段全新的实习故事</span>
            </span>
          </button>
          <button type="button" class="crt-menu-item" data-action="load-save">
            <span class="crt-menu-marker">&gt;</span>
            <span class="crt-menu-item-text">
              <span>[2] 载入存档</span>
              <span class="crt-menu-item-hint">输入存档密码继续游戏</span>
            </span>
          </button>
        </div>
        <div class="crt-login-load-panel hidden">
          <label class="crt-login-load-label">C:\\&gt; 请输入存档密码（即存档链接 ? 后面的部分）：</label>
          <input type="text" class="crt-login-load-input" placeholder="粘贴存档字符串..." autocomplete="off" spellcheck="false" />
          <div class="crt-login-load-actions">
            <button type="button" class="crt-btn" data-action="confirm-load">确定</button>
            <button type="button" class="crt-btn" data-action="cancel-load">取消</button>
          </div>
          <p class="crt-login-feedback hidden"></p>
        </div>
        <div class="crt-login-footer">${i18n.t("mainmenu.footer", "在你继续之前，选择一个选项以进入游戏。")}</div>
      </div>
    `;

    const loadPanel = this.rootEl.querySelector(".crt-login-load-panel");
    const loadInput = this.rootEl.querySelector(".crt-login-load-input");
    const feedback = this.rootEl.querySelector(".crt-login-feedback");
    const tiles = this.rootEl.querySelector(".crt-menu-list");

    this.rootEl.querySelector('[data-action="new-game"]').addEventListener("click", () => {
      this.hide();
      this.onNewGame();
    });

    this.rootEl.querySelector('[data-action="load-save"]').addEventListener("click", () => {
      tiles.classList.add("hidden");
      loadPanel.classList.remove("hidden");
      loadInput.focus();
    });

    this.rootEl.querySelector('[data-action="cancel-load"]').addEventListener("click", () => {
      loadPanel.classList.add("hidden");
      tiles.classList.remove("hidden");
      feedback.classList.add("hidden");
      loadInput.value = "";
    });

    const confirmLoad = () => {
      const raw = loadInput.value.trim().replace(/^\?/, "");
      if (!raw) return;
      const ok = this.onLoadSave(raw);
      if (ok) {
        this.hide();
      } else {
        feedback.classList.remove("hidden");
        feedback.textContent = "存档字符串无效，请检查后重试。";
      }
    };
    this.rootEl.querySelector('[data-action="confirm-load"]').addEventListener("click", confirmLoad);
    loadInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirmLoad();
    });
  }
}
