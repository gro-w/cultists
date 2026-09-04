import { WindowFrame } from "./WindowFrame.js";
import { Taskbar } from "./Taskbar.js";
import { renderDesktopIcons } from "./DesktopIcon.js";
import { GAME_CLOCK_EVENTS } from "../core/GameClock.js";
import { resolvePropertyValue } from "../core/PropertyBinding.js";

/**
 * DesktopShell - presentation-only root: desktop background, icon layer,
 * window layer and taskbar. Opening/dragging/resizing/focusing windows never
 * advances game time or phase (plan §4.1); it only calls WindowManager.
 */
export class DesktopShell {
  /**
   * @param {import('../core/WindowManager.js').WindowManager} windowManager
   * @param {import('../core/WindowDefinitionStore.js').WindowDefinitionStore} windowDefinitionStore
   * @param {import('../core/EventBus.js').default} eventBus
   * @param {HTMLElement} rootEl
   * @param {import('../core/GameClock.js').GameClock} [gameClock]
   * @param {import('../core/VariableStore.js').VariableStore} [variableStore] - lets widget/window
   *   properties be sourced from blueprint value-output wiring instead of only fixed literals
   */
  constructor(windowManager, windowDefinitionStore, eventBus, rootEl, gameClock, variableStore) {
    this.windowManager = windowManager;
    this.windowDefinitionStore = windowDefinitionStore;
    this.eventBus = eventBus;
    this.rootEl = rootEl;
    this.gameClock = gameClock || null;
    this.variableStore = variableStore || null;
    // Set post-construction by engine.js (mirrors `shell.runActivity`), so
    // component interaction events (plan §4.2 onClick/onChange/...) reach
    // the exact same ActivityExecutionService as every other Activity.
    this.runWidgetEvent = null;
    this.frames = new Map(); // instanceId -> WindowFrame
    this._buildDom();
    this._bindEvents();
    this._startClock();
  }

  _buildDom() {
    this.rootEl.innerHTML = `
      <div class="desktop">
        <div class="desktop-icons"></div>
        <div class="window-layer"></div>
      </div>
      <div class="taskbar"></div>
    `;
    this.iconsEl = this.rootEl.querySelector(".desktop-icons");
    this.windowLayerEl = this.rootEl.querySelector(".window-layer");
    this.taskbar = new Taskbar(this.windowManager, this.eventBus, this.rootEl.querySelector(".taskbar"));
  }

  /** Renders the in-game clock (plan §4.1: never system time/timers); updates only when GameClock actually advances. */
  _startClock() {
    const render = () => {
      this.taskbar.setClockText(this.gameClock ? this.gameClock.formatClock() : "");
    };
    render();
    if (this.gameClock) {
      this._unsubscribeClock = this.eventBus.on(GAME_CLOCK_EVENTS.changed, render);
    }
  }

  dispose() {
    if (this._unsubscribeClock) this._unsubscribeClock();
    this._unsubscribeClock = null;
  }

  _bindEvents() {
    this.eventBus.on("window:opened", ({ instanceId }) => this._mountFrame(instanceId));
    this.eventBus.on("window:closed", ({ instanceId }) => this._unmountFrame(instanceId));
  }

  /**
   * Renders desktop icons from `DesktopIconManager.list()` (plan §8.1/§8.2).
   * Double-click always routes through `this.runIconBlueprint(icon)`
   * (assigned post-construction by engine.js, mirroring `runActivity`) -
   * the icon itself never carries a windowId/activityId shortcut. Reorder
   * and free-move both mutate `iconManager` then re-render + persist.
   */
  mountIcons(iconManager) {
    this.iconManager = iconManager;
    this._renderIcons();
  }

  _renderIcons() {
    renderDesktopIcons(this.iconsEl, this.iconManager.list(), {
      onActivate: (icon) => this.runIconBlueprint?.(icon),
      onReorder: (iconId, newOrder) => {
        if (this.iconManager.reorder(iconId, newOrder)) {
          this._renderIcons();
          this.onIconsChanged?.();
        }
      },
      onFreeMove: (iconId, x, y) => {
        if (this.iconManager.setFreePosition(iconId, x, y)) {
          this._renderIcons();
          this.onIconsChanged?.();
        }
      },
    });
  }

  openWindow(windowId) {
    const definition = this.windowDefinitionStore.get(windowId);
    if (!definition) throw new Error(`Unknown window definition: ${windowId}`);
    return this.windowManager.open(definition);
  }

  _mountFrame(instanceId) {
    const state = this.windowManager.get(instanceId);
    if (!state) return;
    const definition = this.windowDefinitionStore.get(state.windowId);
    const rendererCtx = {
      variableStore: this.variableStore,
      valueGraph: definition?.valueGraph,
      onEvent: (node, eventName, value) => this.runWidgetEvent?.(state.windowId, node.widgetId, eventName, value),
    };
    // A window's title (like its widget properties) may be a bound value
    // instead of a fixed literal ("窗口属性...也都可以通过蓝图指定"); this
    // only affects the rendered titlebar text, never `WindowManager`'s own
    // state.title (which stays the plain literal/fallback used for the
    // taskbar and singleInstance lookups).
    const title = resolvePropertyValue(definition?.title, rendererCtx, state.title);
    const frame = new WindowFrame(this.windowManager, this.eventBus, { ...state, title }, definition?.body, definition?.root, rendererCtx);
    this.frames.set(instanceId, frame);
    this.windowLayerEl.appendChild(frame.el);
  }

  _unmountFrame(instanceId) {
    const frame = this.frames.get(instanceId);
    if (!frame) return;
    frame.dispose();
    this.frames.delete(instanceId);
  }
}

export default DesktopShell;
