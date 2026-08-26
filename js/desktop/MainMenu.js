/**
 * MainMenu - a full-screen, Windows-XP-styled login/welcome screen shown at
 * boot when there is no save string in the URL. Lets the player either
 * start a brand new game or load an existing save by pasting its save
 * string (the `?...` part of a previously-saved URL) as a "password".
 *
 * Deliberately styled differently from the rest of the (Win95) UI - this
 * screen represents the "OS login" moment before entering the simulated
 * Win95 desktop, so it borrows the classic blue-gradient XP login look
 * instead of the grey Win95 chrome (see css/mainmenu.css).
 */
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
      <div class="xp-login-backdrop">
        <div class="xp-login-header">
          <span class="xp-login-title">Cultists OS</span>
        </div>
        <div class="xp-login-body">
          <button type="button" class="xp-user-tile" data-action="new-game">
            <span class="xp-user-icon">🧑‍⚕️</span>
            <span class="xp-user-name">新游戏</span>
            <span class="xp-user-hint">开始一段全新的实习故事</span>
          </button>
          <button type="button" class="xp-user-tile" data-action="load-save">
            <span class="xp-user-icon">🔑</span>
            <span class="xp-user-name">载入存档</span>
            <span class="xp-user-hint">输入存档密码继续游戏</span>
          </button>
        </div>
        <div class="xp-login-load-panel hidden">
          <label class="xp-login-load-label">请输入存档密码（即存档链接 ? 后面的部分）：</label>
          <input type="text" class="xp-login-load-input" placeholder="粘贴存档字符串..." />
          <div class="xp-login-load-actions">
            <button type="button" class="xp-login-btn" data-action="confirm-load">确定</button>
            <button type="button" class="xp-login-btn" data-action="cancel-load">取消</button>
          </div>
          <p class="xp-login-feedback hidden"></p>
        </div>
        <div class="xp-login-footer">在你继续之前，选择一个选项以进入 Cultists OS。</div>
      </div>
    `;

    const loadPanel = this.rootEl.querySelector(".xp-login-load-panel");
    const loadInput = this.rootEl.querySelector(".xp-login-load-input");
    const feedback = this.rootEl.querySelector(".xp-login-feedback");
    const tiles = this.rootEl.querySelector(".xp-login-body");

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
