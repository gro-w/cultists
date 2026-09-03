import { PointerInteraction } from "./PointerInteraction.js";

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
   */
  constructor(windowManager, eventBus, state, body) {
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.instanceId = state.instanceId;
    this._unsubscribers = [];
    this._drag = new PointerInteraction();
    this._resize = new PointerInteraction();
    this._buildDom(state, body);
    this._bindControls();
    this._bindDrag();
    if (state.resizable) this._bindResize();
    this._bindEvents();
    this._render(this.windowManager.get(this.instanceId));
  }

  _buildDom(state, body) {
    const el = document.createElement("div");
    el.className = "ng-window bevel-out";
    el.id = state.instanceId;
    el.innerHTML = `
      <div class="ng-titlebar">
        <div class="ng-titlebar-title">
          <span class="ng-titlebar-icon">🗔</span>
          <span class="ng-title"></span>
        </div>
        <div class="ng-window-controls">
          <button type="button" class="ng-window-control ng-min" title="最小化" aria-label="最小化">_</button>
          <button type="button" class="ng-window-control ng-max" title="最大化" aria-label="最大化">□</button>
          <button type="button" class="ng-window-control ng-close" title="关闭" aria-label="关闭">✕</button>
        </div>
      </div>
      <div class="ng-body"></div>
      ${state.resizable ? RESIZE_HANDLES.map((dir) => `<div class="ng-resize-handle ng-resize-${dir}" data-resize="${dir}"></div>`).join("") : ""}
    `;
    el.querySelector(".ng-title").textContent = state.title;
    const bodyEl = el.querySelector(".ng-body");
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body instanceof HTMLElement) bodyEl.appendChild(body);

    this.el = el;
    this.bodyEl = bodyEl;
    this.titlebarEl = el.querySelector(".ng-titlebar");
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
  }

  _bindDrag() {
    this.titlebarEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const state = this.windowManager.get(this.instanceId);
      if (!state || state.maximized) return;
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
        if (!state || state.maximized) return;
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
    if (!state.maximized) {
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
    this.el.remove();
  }
}

export default WindowFrame;
