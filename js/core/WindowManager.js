import Win95Window from "./Window.js";
import { eventBus } from "./EventBus.js";

/**
 * WindowManager - singleton responsible for the whole window system:
 * creation, z-index/focus stacking, taskbar entries, single-instance apps.
 */
class WindowManager {
  constructor() {
    this.windows = new Map(); // id -> Win95Window
    this.zCounter = 10;
    this.layer = null;
    this._singleInstanceKeys = new Map(); // appId -> windowId
  }

  /** Must be called once the DOM is ready. */
  mount(layerEl) {
    this.layer = layerEl;
  }

  /**
   * Create (or focus an existing) window for a given app.
   * @param {object} options - same as Win95Window options, plus:
   * @param {string} [options.appId] - if set, enforces single instance per appId.
   */
  createWindow(options) {
    if (options.appId && this._singleInstanceKeys.has(options.appId)) {
      const existingId = this._singleInstanceKeys.get(options.appId);
      const existing = this.windows.get(existingId);
      if (existing) {
        existing.restore();
        this.focus(existing.id);
        return existing;
      }
    }

    const win = new Win95Window({
      ...options,
      onClose: (w) => this._handleClose(w, options),
      onFocus: (w) => this.focus(w.id),
    });

    this.windows.set(win.id, win);
    if (options.appId) this._singleInstanceKeys.set(options.appId, win.id);

    this.layer.appendChild(win.el);
    this.focus(win.id);

    eventBus.emit("window:opened", { id: win.id, title: win.title, icon: win.icon });
    return win;
  }

  _handleClose(win, options) {
    this.windows.delete(win.id);
    if (options.appId && this._singleInstanceKeys.get(options.appId) === win.id) {
      this._singleInstanceKeys.delete(options.appId);
    }
    if (options.onClose) options.onClose(win);
    eventBus.emit("window:closed", { id: win.id });
  }

  focus(id) {
    const win = this.windows.get(id);
    if (!win) return;
    this.zCounter += 1;
    win.el.style.zIndex = String(this.zCounter);
    win.restore();
    for (const other of this.windows.values()) {
      other.setFocused(other.id === id);
    }
    eventBus.emit("window:focused", { id });
  }

  close(id) {
    const win = this.windows.get(id);
    if (win) win.close();
  }

  closeByAppId(appId) {
    const id = this._singleInstanceKeys.get(appId);
    if (id) this.close(id);
  }

  /** Return the open Win95Window instance for a single-instance appId, if any. */
  getByAppId(appId) {
    const id = this._singleInstanceKeys.get(appId);
    return id ? this.windows.get(id) : undefined;
  }

  /** appIds of every currently-open single-instance window (used by SaveManager). */
  openAppIds() {
    return [...this._singleInstanceKeys.keys()];
  }

  /**
   * Snapshot every open single-instance window's appId + position, ordered
   * from bottom to top of the z-stack (used by SaveManager so re-opening
   * them in this same order on load recreates the original stacking).
   * @returns {{appId:string, x:number, y:number}[]}
   */
  windowSnapshot() {
    const entries = [];
    for (const [appId, winId] of this._singleInstanceKeys.entries()) {
      const win = this.windows.get(winId);
      if (!win) continue;
      entries.push({
        appId,
        x: win.el.offsetLeft,
        y: win.el.offsetTop,
        z: parseInt(win.el.style.zIndex, 10) || 0,
      });
    }
    entries.sort((a, b) => a.z - b.z);
    return entries.map(({ appId, x, y }) => ({ appId, x, y }));
  }

  /** Move an already-open single-instance window's appId to a given position. */
  moveWindow(appId, x, y) {
    const win = this.getByAppId(appId);
    if (win) win.moveTo(x, y);
  }

  /** Close every window whose appId is not in the allowed list (used by DayNightSystem). */
  closeAllExcept(allowedAppIds = []) {
    for (const [appId, winId] of [...this._singleInstanceKeys.entries()]) {
      if (!allowedAppIds.includes(appId)) {
        this.close(winId);
      }
    }
  }

  list() {
    return [...this.windows.values()];
  }
}

export const windowManager = new WindowManager();
export default WindowManager;
