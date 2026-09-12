import { WindowFrame } from "./WindowFrame.js";
export class WindowManager {
  constructor(layer, eventBus) { this.layer = layer; this.eventBus = eventBus; this.definitions = new Map(); this.instances = new Map(); this.geometry = new Map(); this.z = 10; try { const saved = JSON.parse(localStorage.getItem("cultists-ng-window-geometry") || "{}"); for (const [id, geometry] of Object.entries(saved)) this.geometry.set(id, geometry); } catch { /* ignore a corrupt optional layout cache */ } }
  register(definition) { this.definitions.set(definition.id, definition); }
  openDynamic({ id, title, content = {}, width = 640, height = 480, x = 60, y = 40 } = {}) {
    const definition = { id, title, geometry: { x, y, width, height }, content: content instanceof HTMLElement ? {} : content };
    this.register(definition);
    const frame = this.open(id);
    if (content instanceof HTMLElement) frame.el.querySelector(".ng-body").replaceChildren(content);
    return frame;
  }
  open(windowId) {
    const definition = this.definitions.get(windowId);
    if (!definition) throw new Error(`Unknown window: ${windowId}`);
    const frame = new WindowFrame(this, definition);
    this.instances.set(frame.windowInstanceId, frame); this.layer.append(frame.el); this.focus(frame.windowInstanceId); if (definition.fullscreen) frame.maximize();
    this.eventBus.emit("window:created", { windowId, windowInstanceId: frame.windowInstanceId });
    return frame;
  }
  close(instanceId) {
    const frame = this.instances.get(instanceId); if (!frame) return;
    frame.persistGeometry(); frame.resizeObserver?.disconnect(); frame.el.remove(); this.instances.delete(instanceId);
    this.eventBus.emit("window:closed", { windowId: frame.definition.id, windowInstanceId: instanceId });
  }
  focus(instanceId) {
    const frame = this.instances.get(instanceId);
    if (!frame) return;
    frame.el.style.zIndex = String(++this.z);
    for (const other of this.instances.values()) other.el.classList.toggle("focused", other === frame);
    this.eventBus.emit("window:focused", { windowInstanceId: instanceId });
  }
  minimize(frame) { frame.el.classList.toggle("minimized"); this.eventBus.emit("window:changed", { windowInstanceId: frame.windowInstanceId, action: "minimize" }); }
  handleWindowAction(frame, action) { if (action === "close") this.close(frame.windowInstanceId); else if (action === "minimize") this.minimize(frame); else if (action === "maximize") frame.maximize(); }
  getSavedGeometry(windowId) { const g = this.geometry.get(windowId); return g ? { ...g } : null; }
  viewport() { return { width: this.layer.clientWidth || globalThis.innerWidth || 0, height: this.layer.clientHeight || Math.max(0, (globalThis.innerHeight || 0) - 28) }; }
  clampGeometry({ x = 0, y = 0, width = 420, height = 260 }) {
    const { width: viewportWidth, height: viewportHeight } = this.viewport();
    const minWidth = 220;
    const minHeight = 140;
    const safeWidth = Math.max(minWidth, Number(width) || minWidth);
    const safeHeight = Math.max(minHeight, Number(height) || minHeight);
    return { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0), width: Math.round(safeWidth), height: Math.round(safeHeight) };
  }
  clampTitlebarGeometry({ x = 0, y = 0, width = 420, height = 260 }) {
    const geometry = this.clampGeometry({ x, y, width, height });
    const { width: viewportWidth, height: viewportHeight } = this.viewport();
    const visibleTitlebar = 48;
    return {
      ...geometry,
      x: Math.min(viewportWidth - visibleTitlebar, Math.max(-(geometry.width - visibleTitlebar), geometry.x)),
      y: Math.min(viewportHeight - 20, Math.max(0, geometry.y)),
    };
  }
  saveGeometry(windowId, geometry) { this.geometry.set(windowId, { ...geometry }); try { localStorage.setItem("cultists-ng-window-geometry", JSON.stringify(Object.fromEntries(this.geometry))); } catch { /* layout persistence is best effort */ } this.eventBus.emit("window:geometry-changed", { windowId, geometry: { ...geometry } }); }
  geometryFromElement(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; }
  snapshot() { return { geometry: Object.fromEntries(this.geometry), open: [...this.instances.values()].map((frame) => ({ windowId: frame.definition.id, windowInstanceId: frame.windowInstanceId, geometry: this.geometryFromElement(frame.el), minimized: frame.el.classList.contains("minimized"), maximized: frame.el.dataset.maximized === "true" })) }; }
}
