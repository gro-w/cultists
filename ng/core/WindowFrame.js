import { WindowRuntime } from "./WindowRuntime.js";

function uuid(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}
export class WindowFrame {
  constructor(manager, definition) {
    this.manager = manager;
    this.definition = definition;
    this.windowInstanceId = uuid("window");
    this.el = document.createElement("article");
    this.el.className = "ng-window bevel-out";
    this.el.dataset.windowId = definition.id;
    this.el.dataset.windowInstanceId = this.windowInstanceId;
    this.el.style.minWidth = `${definition.minWidth ?? 220}px`;
    this.el.style.minHeight = `${definition.minHeight ?? 140}px`;
    this.el.innerHTML = `<header class="ng-titlebar"><div class="ng-titlebar-title"><button class="ng-titlebar-icon" type="button" title="窗口菜单" aria-label="窗口菜单"></button><span class="ng-title"></span></div><div class="ng-window-controls"><button class="ng-window-control" data-action="minimize" title="最小化" aria-label="最小化">_</button><button class="ng-window-control" data-action="maximize" title="最大化" aria-label="最大化">□</button><button class="ng-window-control" data-action="close" title="关闭" aria-label="关闭">✕</button></div></header><nav class="ng-system-menu" hidden><button type="button" data-command="restore">还原(R)</button><button type="button" data-command="move">移动(M)</button><button type="button" data-command="minimize">最小化(N)</button><button type="button" data-command="maximize">最大化(X)</button><hr><button type="button" data-command="close">关闭(C)</button></nav><div class="ng-body"></div><div class="ng-resize-handle ng-resize-n" data-resize="n"></div><div class="ng-resize-handle ng-resize-ne" data-resize="ne"></div><div class="ng-resize-handle ng-resize-e" data-resize="e"></div><div class="ng-resize-handle ng-resize-se" data-resize="se"></div><div class="ng-resize-handle ng-resize-s" data-resize="s"></div><div class="ng-resize-handle ng-resize-sw" data-resize="sw"></div><div class="ng-resize-handle ng-resize-w" data-resize="w"></div><div class="ng-resize-handle ng-resize-nw" data-resize="nw"></div>`;
    this.el.querySelector(".ng-titlebar-icon").textContent = definition.logo || "▣";
    this.el.querySelector(".ng-title").textContent = definition.title || definition.id;
    this.el.querySelector(".ng-body").appendChild(this.renderContent(definition.content || {}));
    this.bindControls();
    this.bindSystemMenu();
    this.restoreGeometry();
    this.bindDrag();
    this.bindResize();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.el.dataset.maximized === "true" || this.resizing) return;
      const current = this.manager.geometryFromElement(this.el);
      const clamped = this.manager.clampTitlebarGeometry(current);
      this.setGeometry(clamped);
      this.persistGeometry();
    });
    this.resizeObserver.observe(this.el);
  }
  renderContent(content) {
    if (content.root) return new WindowRuntime().render(content, document.createElement("div"));
    const panel = document.createElement("div");
    panel.className = "ng-panel";
    const heading = document.createElement("h1");
    heading.textContent = content.heading || this.definition.title || this.definition.id;
    panel.append(heading);
    for (const text of content.paragraphs || []) {
      const p = document.createElement("p"); p.textContent = text; panel.append(p);
    }
    return panel;
  }
  bindControls() {
    this.el.addEventListener("pointerdown", () => this.manager.focus(this.windowInstanceId));
    this.el.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); this.manager.handleWindowAction(this, button.dataset.action);
    }));
  }
  bindSystemMenu() {
    const icon = this.el.querySelector(".ng-titlebar-icon");
    const menu = this.el.querySelector(".ng-system-menu");
    icon.addEventListener("click", (event) => { event.stopPropagation(); this.manager.focus(this.windowInstanceId); menu.hidden = !menu.hidden; });
    icon.addEventListener("dblclick", (event) => { event.stopPropagation(); this.manager.close(this.windowInstanceId); });
    menu.addEventListener("click", (event) => {
      const command = event.target.closest("[data-command]")?.dataset.command;
      if (!command) return;
      event.stopPropagation(); menu.hidden = true;
      if (command === "close") this.manager.close(this.windowInstanceId);
      else if (command === "minimize") this.manager.minimize(this);
      else if (command === "maximize") { if (this.el.dataset.maximized !== "true") this.maximize(); }
      else if (command === "restore") this.restore();
      else if (command === "move") this.manager.focus(this.windowInstanceId);
    });
    document.addEventListener("click", (event) => { if (!this.el.contains(event.target)) menu.hidden = true; }, { capture: true });
    this.el.querySelector(".ng-titlebar").addEventListener("dblclick", (event) => { if (!event.target.closest("button")) this.maximize(); });
  }
  bindDrag() {
    const bar = this.el.querySelector(".ng-titlebar");
    let drag = null;
    bar.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button") || this.el.dataset.maximized === "true") return;
      this.manager.focus(this.windowInstanceId);
      const rect = this.el.getBoundingClientRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top };
      bar.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    bar.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (this.el.dataset.maximized === "true") return;
      this.setPosition(drag.x + event.clientX - drag.startX, drag.y + event.clientY - drag.startY);
    });
    const stop = (event) => { if (drag?.pointerId === event.pointerId) { this.persistGeometry(); drag = null; } };
    bar.addEventListener("pointerup", stop); bar.addEventListener("pointercancel", stop);
  }
  bindResize() {
    for (const handle of this.el.querySelectorAll("[data-resize]")) {
      const direction = handle.dataset.resize;
      let start;
      const move = (event) => {
        if (!start || event.pointerId !== start.pointerId) return;
        const dx = event.clientX - start.clientX;
        const dy = event.clientY - start.clientY;
        let { x, y, width, height } = start;
        if (direction.includes("e")) width = Math.max(220, start.width + dx);
        if (direction.includes("s")) height = Math.max(140, start.height + dy);
        if (direction.includes("w")) { width = Math.max(220, start.width - dx); x = start.x + start.width - width; }
        if (direction.includes("n")) { height = Math.max(140, start.height - dy); y = start.y + start.height - height; }
        const geometry = this.manager.clampTitlebarGeometry({ x, y, width, height });
        this.setGeometry(geometry);
      };
      const stop = (event) => {
        if (!start || event.pointerId !== start.pointerId) return;
        handle.releasePointerCapture?.(event.pointerId);
        this.resizing = false;
        this.el.classList.remove("resizing");
        start = null;
        this.persistGeometry();
      };
      handle.addEventListener("pointerdown", (event) => {
        if (this.el.dataset.maximized === "true") return;
        event.preventDefault();
        event.stopPropagation();
        this.manager.focus(this.windowInstanceId);
        const geometry = this.manager.geometryFromElement(this.el);
        start = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...geometry };
        this.resizing = true;
        this.el.classList.add("resizing");
        handle.setPointerCapture?.(event.pointerId);
      });
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    }
  }
  restoreGeometry() {
    const saved = this.manager.getSavedGeometry(this.definition.id);
    const g = saved || this.definition.geometry || { x: 80, y: 60, width: 420, height: 260 };
    this.setGeometry(this.manager.clampTitlebarGeometry(g));
  }
  setGeometry({ x = 0, y = 0, width, height }) {
    this.el.style.left = `${x}px`; this.el.style.top = `${y}px`;
    if (width != null) this.el.style.width = `${width}px`;
    if (height != null) this.el.style.height = `${height}px`;
  }
  setPosition(x, y) { const g = this.manager.clampTitlebarGeometry({ x, y, width: this.el.offsetWidth, height: this.el.offsetHeight }); this.el.style.left = `${g.x}px`; this.el.style.top = `${g.y}px`; }
  persistGeometry() {
    const r = this.el.getBoundingClientRect();
    this.manager.saveGeometry(this.definition.id, { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  }
  maximize() {
    if (this.el.dataset.maximized === "true") this.restore();
    else { this.previousGeometry = this.manager.geometryFromElement(this.el); this.el.dataset.maximized = "true"; this.setGeometry({ x: 0, y: 0, width: this.manager.layer.clientWidth, height: this.manager.layer.clientHeight }); }
    this.persistGeometry();
  }
  restore() { if (this.el.dataset.maximized !== "true") return; this.el.dataset.maximized = "false"; this.setGeometry(this.manager.clampTitlebarGeometry(this.previousGeometry || this.definition.geometry)); this.persistGeometry(); }
}
