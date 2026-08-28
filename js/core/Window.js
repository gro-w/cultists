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
          <span class="win95-titlebar-icon">${this.icon}</span>
          <span class="win95-titlebar-text"></span>
        </div>
        <div class="win95-titlebar-controls">
          <button type="button" class="bevel-out win95-min" title="最小化" aria-label="最小化">_</button>
          <button type="button" class="bevel-out win95-max" title="最大化" aria-label="最大化">□</button>
          <button type="button" class="bevel-out win95-close" title="关闭">✕</button>
        </div>
      </div>
      <div class="win95-window-body"></div>
      ${this.resizable ? '<div class="win95-window-resize-handle"></div>' : ""}
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
      this.el.style.left = `${Math.max(0, originLeft + dx)}px`;
      this.el.style.top = `${Math.max(0, originTop + dy)}px`;
    };
    const onMouseUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    this.titlebarEl.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = this.el.offsetLeft;
      originTop = this.el.offsetTop;
      this.focus();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  }

  _bindResize() {
    const handle = this.el.querySelector(".win95-window-resize-handle");
    if (!handle) return;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let resizing = false;

    const onMouseMove = (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.el.style.width = `${Math.max(240, startW + dx)}px`;
      this.el.style.height = `${Math.max(140, startH + dy)}px`;
    };
    const onMouseUp = () => {
      resizing = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = this.el.offsetWidth;
      startH = this.el.offsetHeight;
      this.focus();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  }

  focus() {
    if (this.onFocus) this.onFocus(this);
  }

  setFocused(isFocused) {
    this.el.classList.toggle("focused", isFocused);
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
    this.el.style.display = this.minimized ? "none" : "flex";
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
  }

  restore() {
    this.minimized = false;
    this.el.style.display = "flex";
  }

  /** Reposition the window (used when restoring a save's window layout). */
  moveTo(x, y) {
    this.el.style.left = `${Math.max(0, x)}px`;
    this.el.style.top = `${Math.max(0, y)}px`;
  }

  close() {
    this.el.remove();
    if (this.onClose) this.onClose(this);
  }
}
