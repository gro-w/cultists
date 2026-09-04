import { WindowFrame } from "./WindowFrame.js";
import { Taskbar } from "./Taskbar.js";
import { renderDesktopIcons } from "./DesktopIcon.js";
import { GAME_CLOCK_EVENTS } from "../core/GameClock.js";

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
   * Render desktop icon placeholders. Double-click either opens the bound
   * window definition directly, or - if the icon declares `activityId`
   * instead - runs that Activity through `runActivity` (plan §7.4: the
   * off-duty icon does not call `openWindow` itself; it routes through a
   * blueprint that opens the window and then advances time). Full
   * icon/blueprint-routing schema and drag/reorder are Phase 5 work; this is
   * just the minimal hook Phase 4's off-duty example needs.
   */
  mountIcons(icons) {
    renderDesktopIcons(this.iconsEl, icons, (icon) => {
      if (icon.activityId) this.runActivity?.(icon.activityId);
      else this.openWindow(icon.windowId);
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
    const rendererCtx = { variableStore: this.variableStore, valueGraph: definition?.valueGraph };
    const frame = new WindowFrame(this.windowManager, this.eventBus, state, definition?.body, definition?.root, rendererCtx);
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
