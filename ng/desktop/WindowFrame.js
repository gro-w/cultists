import { PointerInteraction } from "./PointerInteraction.js";
import { renderWindowRoot } from "../core/WidgetLayoutRenderer.js";

const RESIZE_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * WindowFrame - DOM rendering + gesture wiring for a single open window
 * instance. All authoritative state (position, size, focus, minimized,
 * maximized) lives in WindowManager; this class only reflects that state in
 * the DOM and forwards pointer gestures back into the manager.
 */
export class WindowFrame {
  /**
   * @param {import('../core/WindowManager.js').WindowManager} windowManager
   * @param {import('../core/EventBus.js').default} eventBus
   * @param {{instanceId:string,windowId:string,title:string,resizable:boolean}} state
   * @param {HTMLElement|string} [body] - element or HTML string for the window body
   * @param {object} [root] - widget tree (plan §7.1); when given it is rendered via
   *   the same `renderWindowRoot()` the editor preview uses, and `body` is ignored
   * @param {object} [rendererCtx] - `{ variableStore, valueGraph }` for widget/window
   *   properties sourced from blueprint value-output wiring instead of literals
   */
  constructor(windowManager, eventBus, state, body, root, rendererCtx = {}) {
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.instanceId = state.instanceId;
    this._unsubscribers = [];
    this._drag = new PointerInteraction();
    this._resize = new PointerInteraction();
    this._buildDom(state, body, root, rendererCtx);
    this._bindControls();
    this._bindDrag();
    if (state.resizable) this._bindResize();
    this._bindEvents();
    this._render(this.windowManager.get(this.instanceId));
  }

  _buildDom(state, body, root, rendererCtx = {}) {
    const el = document.createElement("div");
    el.className = "ng-window bevel-out";
    el.id = state.instanceId;
    el.innerHTML = `
      <div class="ng-titlebar">
        <div class="ng-titlebar-title">
          <span class="ng-titlebar-icon" tabindex="0" role="button" aria-haspopup="true" aria-label="系统菜单">${state.icon || "🗔"}</span>
          <span class="ng-title"></span>
        </div>
        <div class="ng-window-controls">
          <button type="button" class="ng-window-control ng-min" title="最小化" aria-label="最小化">_</button>
          <button type="button" class="ng-window-control ng-max" title="最大化" aria-label="最大化">□</button>
          <button type="button" class="ng-window-control ng-close" title="关闭" aria-label="关闭">✕</button>
        </div>
      </div>
      <div class="ng-system-menu" hidden>
        <button type="button" class="ng-system-menu-item" data-window-command="restore">还原</button>
        <button type="button" class="ng-system-menu-item" data-window-command="move">移动</button>
        <button type="button" class="ng-system-menu-item" data-window-command="minimize">最小化</button>
        <button type="button" class="ng-system-menu-item" data-window-command="maximize">最大化</button>
        <button type="button" class="ng-system-menu-item ng-system-menu-close" data-window-command="close">关闭</button>
      </div>
      <div class="ng-body"></div>
      ${state.resizable ? RESIZE_HANDLES.map((dir) => `<div class="ng-resize-handle ng-resize-${dir}" data-resize="${dir}"></div>`).join("") : ""}
    `;
    el.querySelector(".ng-title").textContent = state.title;
    const bodyEl = el.querySelector(".ng-body");
    if (root) {
      // Runtime and the WYSIWYG editor preview must render the exact same
      // widget tree with the exact same renderer (plan §7.1).
      const { el: rootEl } = renderWindowRoot(root, rendererCtx);
      bodyEl.appendChild(rootEl);
    } else if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body instanceof HTMLElement) bodyEl.appendChild(body);

    this.el = el;
    this.bodyEl = bodyEl;
    this.titlebarEl = el.querySelector(".ng-titlebar");
    this.iconEl = el.querySelector(".ng-titlebar-icon");
    this.systemMenuEl = el.querySelector(".ng-system-menu");
  }

  _bindControls() {
    this.el.querySelector(".ng-close").addEventListener("click", (e) => {
      e.stopPropagation();
      this.windowManager.close(this.instanceId);
    });
    this.el.querySelector(".ng-min").addEventListener("click", (e) => {
      e.stopPropagation();
      this.windowManager.toggleMinimize(this.instanceId);
    });
    this.el.querySelector(".ng-max").addEventListener("click", (e) => {
      e.stopPropagation();
      this.windowManager.toggleMaximize(this.instanceId);
    });
    this.el.addEventListener("pointerdown", () => this.windowManager.focus(this.instanceId));
    this._bindSystemMenu();
  }

  _bindSystemMenu() {
    this.iconEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.windowManager.focus(this.instanceId);
      this.toggleSystemMenu();
    });
    this.iconEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.hideSystemMenu();
      this.windowManager.close(this.instanceId);
    });
    this.systemMenuEl.addEventListener("click", (e) => {
      const button = e.target.closest("[data-window-command]");
      if (!button) return;
      e.stopPropagation();
      this.hideSystemMenu();
      const command = button.dataset.windowCommand;
      if (command === "close") this.windowManager.close(this.instanceId);
      else if (command === "minimize") this.windowManager.minimize(this.instanceId);
      else if (command === "maximize") this.windowManager.maximize(this.instanceId);
      else if (command === "restore") this.windowManager.unmaximize(this.instanceId);
      else if (command === "move") this.windowManager.focus(this.instanceId);
    });
    this._onOutsideClick = (e) => {
      if (!this.systemMenuEl.hidden && !this.el.contains(e.target)) this.hideSystemMenu();
    };
    document.addEventListener("click", this._onOutsideClick);
  }

  toggleSystemMenu() {
    if (this.systemMenuEl.hidden) this.showSystemMenu();
    else this.hideSystemMenu();
  }

  showSystemMenu() {
    this.systemMenuEl.hidden = false;
  }

  hideSystemMenu() {
    this.systemMenuEl.hidden = true;
  }

  _bindDrag() {
    this.titlebarEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.target.closest(".ng-titlebar-icon")) return;
      const state = this.windowManager.get(this.instanceId);
      if (!state || state.maximized || state.fullscreen) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const originX = state.x;
      const originY = state.y;
      this.windowManager.focus(this.instanceId);
      this._drag.start({
        onMove: (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          this.windowManager.moveTo(this.instanceId, originX + dx, originY + dy);
        },
        onEnd: () => this.windowManager.persistGeometry(this.instanceId),
      });
    });
  }

  _bindResize() {
    this.el.querySelectorAll(".ng-resize-handle").forEach((handle) => {
      const direction = handle.dataset.resize;
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const state = this.windowManager.get(this.instanceId);
        if (!state || state.maximized || state.fullscreen) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = state.width;
        const startH = state.height;
        const startLeft = state.x;
        const startTop = state.y;
        this.windowManager.focus(this.instanceId);
        this.el.classList.add("resizing");
        this._resize.start({
          onMove: (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            let width = startW;
            let height = startH;
            let x = startLeft;
            let y = startTop;
            if (direction.includes("e")) width = startW + dx;
            if (direction.includes("s")) height = startH + dy;
            if (direction.includes("w")) {
              width = startW - dx;
              x = startLeft + dx;
            }
            if (direction.includes("n")) {
              height = startH - dy;
              y = startTop + dy;
            }
            this.windowManager.resize(this.instanceId, width, height);
            const resized = this.windowManager.get(this.instanceId);
            if (direction.includes("w") || direction.includes("n")) {
              this.windowManager.moveTo(this.instanceId, x, y);
              void resized;
            }
          },
          onEnd: () => {
            this.el.classList.remove("resizing");
            this.windowManager.persistGeometry(this.instanceId);
          },
        });
      });
    });
  }

  _bindEvents() {
    const relevant = new Set([
      "window:focused",
      "window:moved",
      "window:resized",
      "window:minimized",
      "window:restored",
      "window:maximized",
      "window:unmaximized",
    ]);
    for (const name of relevant) {
      this._unsubscribers.push(
        this.eventBus.on(name, (payload) => {
          if (payload.instanceId !== this.instanceId) return;
          this._render(this.windowManager.get(this.instanceId));
        }),
      );
    }
  }

  _render(state) {
    if (!state) return;
    this.el.style.zIndex = String(state.zIndex);
    this.el.classList.toggle("minimized", state.minimized);
    this.el.classList.toggle("maximized", state.maximized);
    this.el.classList.toggle("ng-window-fullscreen", Boolean(state.fullscreen));
    if (state.fullscreen) {
      // CSS `.ng-window-fullscreen` covers the whole viewport (and the
      // taskbar) via `position: fixed; inset: 0`, so no inline geometry.
    } else if (!state.maximized) {
      this.el.style.left = `${state.x}px`;
      this.el.style.top = `${state.y}px`;
      this.el.style.width = `${state.width}px`;
      this.el.style.height = `${state.height}px`;
    } else {
      this.el.style.left = "0px";
      this.el.style.top = "0px";
      this.el.style.width = "100%";
      this.el.style.height = "100%";
    }
    const focused = this.windowManager.focusedInstanceId() === this.instanceId;
    this.el.classList.toggle("focused", focused);
  }

  /** Detach every DOM/EventBus subscription and cancel in-flight gestures. */
  dispose() {
    this._drag.cancel();
    this._resize.cancel();
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
    this._unsubscribers = [];
    document.removeEventListener("click", this._onOutsideClick);
    this.el.remove();
  }
}

export default WindowFrame;
