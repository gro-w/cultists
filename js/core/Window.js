/**
 * Window - represents a single Win95-style window instance.
 * Handles its own DOM creation, dragging, focus styling, resize and
 * close/minimize/maximize behaviour. Window content is provided by the app that
 * requests it (see WindowManager.createWindow).
 */

let _windowIdCounter = 0;

export default class Win95Window {
  /**
   * @param {object} options
   * @param {string} options.title
   * @param {string} [options.icon]
   * @param {HTMLElement|string} options.content - element or HTML string
   * @param {number} [options.width]
   * @param {number} [options.height]
   * @param {number} [options.x]
   * @param {number} [options.y]
   * @param {boolean} [options.resizable]
   * @param {(win: Win95Window) => void} [options.onClose]
   * @param {(win: Win95Window) => void} [options.onFocus]
   */
  constructor(options) {
    this.id = `win-${++_windowIdCounter}`;
    this.title = options.title || "Untitled";
    this.icon = options.icon || "🗔";
    this.resizable = options.resizable !== false;
    this.onClose = options.onClose || null;
    this.onFocus = options.onFocus || null;
    this.minimized = false;
    this.maximized = false;
    this._normalBounds = null;

    this._buildDom(options);
    this._bindDrag();
    if (this.resizable) this._bindResize();
  }

  _buildDom(options) {
    const el = document.createElement("div");
    el.className = "win95-window bevel-out";
    el.id = this.id;
    el.style.left = `${options.x ?? 60 + Math.random() * 80}px`;
    el.style.top = `${options.y ?? 40 + Math.random() * 60}px`;
    el.style.width = `${options.width || 480}px`;
    el.style.height = `${options.height || 360}px`;

    el.innerHTML = `
      <div class="win95-titlebar">
        <div class="win95-titlebar-title">
          <span class="win95-titlebar-icon" title="窗口菜单">${this.icon}</span>
          <span class="win95-titlebar-text"></span>
        </div>
        <div class="win95-titlebar-controls">
          <button type="button" class="bevel-out win95-min" title="最小化" aria-label="最小化">_</button>
          <button type="button" class="bevel-out win95-max" title="最大化" aria-label="最大化">□</button>
          <button type="button" class="bevel-out win95-close" title="关闭">✕</button>
        </div>
      </div>
      <div class="win95-system-menu" role="menu" hidden>
        <button type="button" data-window-command="restore">还原(R)</button>
        <button type="button" data-window-command="move">移动(M)</button>
        <button type="button" data-window-command="minimize">最小化(N)</button>
        <button type="button" data-window-command="maximize">最大化(X)</button>
        <div class="win95-system-menu-separator"></div>
        <button type="button" data-window-command="close">关闭(C)</button>
      </div>
      <div class="win95-window-body"></div>
      ${this.resizable ? `
        <div class="win95-window-resize-handle win95-resize-n" data-resize="n"></div>
        <div class="win95-window-resize-handle win95-resize-ne" data-resize="ne"></div>
        <div class="win95-window-resize-handle win95-resize-e" data-resize="e"></div>
        <div class="win95-window-resize-handle win95-resize-se" data-resize="se"></div>
        <div class="win95-window-resize-handle win95-resize-s" data-resize="s"></div>
        <div class="win95-window-resize-handle win95-resize-sw" data-resize="sw"></div>
        <div class="win95-window-resize-handle win95-resize-w" data-resize="w"></div>
        <div class="win95-window-resize-handle win95-resize-nw" data-resize="nw"></div>
      ` : ""}
    `;

    el.querySelector(".win95-titlebar-text").textContent = this.title;

    const body = el.querySelector(".win95-window-body");
    if (typeof options.content === "string") {
      body.innerHTML = options.content;
    } else if (options.content instanceof HTMLElement) {
      body.appendChild(options.content);
    }

    el.querySelector(".win95-close").addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });
    el.querySelector(".win95-min").addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });
    el.querySelector(".win95-max").addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMaximize();
    });
    el.addEventListener("mousedown", () => this.focus());

    this.el = el;
    this.bodyEl = body;
    this.titlebarEl = el.querySelector(".win95-titlebar");
    this.systemMenuEl = el.querySelector(".win95-system-menu");
    this._bindSystemMenu();
  }

  _bindSystemMenu() {
    const icon = this.el.querySelector(".win95-titlebar-icon");
    const menu = this.systemMenuEl;
    if (!icon || !menu) return;
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) { this.focus(); menu.hidden = false; } else menu.hidden = true;
    });
    icon.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.close();
    });
    menu.querySelectorAll("[data-window-command]").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        this._runSystemCommand(button.dataset.windowCommand);
      });
    });
    this._menuOutsideHandler = (e) => {
      if (!this.el.contains(e.target)) menu.hidden = true;
    };
    document.addEventListener("click", this._menuOutsideHandler);
  }

  _runSystemCommand(command) {
    if (this.systemMenuEl) this.systemMenuEl.hidden = true;
    if (command === "close") return this.close();
    if (command === "move") return this.focus();
    if (command === "minimize") return this.toggleMinimize();
    if (command === "maximize") {
      if (this.minimized) this.restore();
      if (!this.maximized) this.toggleMaximize();
      return;
    }
    if (command === "restore") {
      if (this.minimized) this.restore();
      if (this.maximized) this._restoreNormalBounds();
    }
  }

  _bindDrag() {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.el.style.left = `${this._clampLeft(originLeft + dx)}px`;
      this.el.style.top = `${this._clampTop(originTop + dy)}px`;
    };
    const onMouseUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    this.titlebarEl.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest(".win95-titlebar-icon")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = this.el.offsetLeft;
      originTop = this.el.offsetTop;
      this.focus();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
    this.titlebarEl.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest(".win95-titlebar-icon")) return;
      this.toggleMaximize();
    });
  }

  _bindResize() {
    const handles = this.el.querySelectorAll(".win95-window-resize-handle");
    if (!handles.length) return;
    handles.forEach((handle) => {
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let startW = 0;
      let startH = 0;
      let resizing = false;
      const direction = handle.dataset.resize;

      const onMouseMove = (e) => {
        if (!resizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let width = startW;
        let height = startH;
        let left = startLeft;
        let top = startTop;

        if (direction.includes("e")) width = Math.max(260, startW + dx);
        if (direction.includes("s")) height = Math.max(160, startH + dy);
        if (direction.includes("w")) {
          width = Math.max(260, startW - dx);
          left = startLeft + (startW - width);
        }
        if (direction.includes("n")) {
          height = Math.max(160, startH - dy);
          top = startTop + (startH - height);
        }

        this.el.style.left = `${this._clampLeft(left)}px`;
        this.el.style.top = `${this._clampTop(top)}px`;
        this.el.style.width = `${width}px`;
        this.el.style.height = `${height}px`;
      };
      const onMouseUp = () => {
        resizing = false;
        this.el.classList.remove("resizing");
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = this.el.offsetLeft;
        startTop = this.el.offsetTop;
        startW = this.el.offsetWidth;
        startH = this.el.offsetHeight;
        this.el.classList.add("resizing");
        this.focus();
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      });
    });
  }

  _clampLeft(left) {
    return Math.max(-(this.el.offsetWidth - 48), left);
  }

  _desktopBottom() {
    const taskbar = document.querySelector(".taskbar");
    const taskbarHeight = taskbar?.getBoundingClientRect().height || 0;
    return Math.max(0, window.innerHeight - taskbarHeight);
  }

  _clampTop(top) {
    const titlebarHeight = this.titlebarEl?.offsetHeight || 20;
    const maxTop = Math.max(0, this._desktopBottom() - titlebarHeight);
    return Math.min(maxTop, Math.max(0, top));
  }

  _ensureVisible() {
    const viewportWidth = window.innerWidth;
    const desktopBottom = this._desktopBottom();
    const left = this.el.offsetLeft;
    const top = this.el.offsetTop;
    const right = left + this.el.offsetWidth;
    const bottom = top + this.el.offsetHeight;
    const completelyOutside = right <= 0 || left >= viewportWidth || bottom <= 0;
    const completelyBehindTaskbar = top >= desktopBottom;
    if (completelyOutside || completelyBehindTaskbar) {
      this.el.style.left = "60px";
      this.el.style.top = "40px";
    } else {
      this.el.style.top = `${this._clampTop(top)}px`;
    }
  }

  focus() {
    if (this.onFocus) this.onFocus(this);
  }

  setFocused(isFocused) {
    this.el.classList.toggle("focused", isFocused);
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
    if (this.minimized) this.el.style.display = "none";
    else this.restore();
  }

  toggleMaximize() {
    if (this.maximized) {
      this._restoreNormalBounds();
      return;
    }
    this._normalBounds = {
      left: this.el.style.left,
      top: this.el.style.top,
      width: this.el.style.width,
      height: this.el.style.height,
    };
    this.maximized = true;
    this.el.classList.add("maximized");
    this.el.style.left = "0px";
    this.el.style.top = "0px";
    this.el.style.width = "100%";
    this.el.style.height = "100%";
    const button = this.el.querySelector(".win95-max");
    button.title = "还原";
    button.setAttribute("aria-label", "还原");
  }

  _restoreNormalBounds() {
    if (!this._normalBounds) return;
    const { left, top, width, height } = this._normalBounds;
    this.maximized = false;
    this.el.classList.remove("maximized");
    this.el.style.left = left;
    this.el.style.top = top;
    this.el.style.width = width;
    this.el.style.height = height;
    const button = this.el.querySelector(".win95-max");
    button.title = "最大化";
    button.setAttribute("aria-label", "最大化");
    this._ensureVisible();
  }

  restore() {
    this.minimized = false;
    this.el.style.display = "flex";
    this._ensureVisible();
  }

  /** Reposition the window (used when restoring a save's window layout). */
  moveTo(x, y) {
    this.el.style.left = `${this._clampLeft(x)}px`;
    this.el.style.top = `${Math.max(0, y)}px`;
    this._ensureVisible();
  }

  close() {
    if (this._menuOutsideHandler) {
      document.removeEventListener("click", this._menuOutsideHandler);
      this._menuOutsideHandler = null;
    }
    this.el.remove();
    if (this.onClose) this.onClose(this);
  }
}
