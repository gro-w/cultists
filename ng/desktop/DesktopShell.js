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
   * @param {import('../core/PublicVariableManager.js').PublicVariableManager} [pvGateway] - resolves
   *   public-variable value nodes used by widget/window bindings
   * @param {object} [runtimeGateway] generic runtime collections exposed to value blueprints
   */
  constructor(windowManager, windowDefinitionStore, eventBus, rootEl, gameClock, variableStore, pvGateway, dbGateway, runtimeGateway, dialogueRegistry, keywordManager, customWidgetFactories = {}) {
    this.windowManager = windowManager;
    this.windowDefinitionStore = windowDefinitionStore;
    this.eventBus = eventBus;
    this.rootEl = rootEl;
    this.gameClock = gameClock || null;
    this.variableStore = variableStore || null;
    this.pvGateway = pvGateway || null;
    this.dbGateway = dbGateway || null;
    this.runtimeGateway = runtimeGateway || null;
    this.dialogueRegistry = dialogueRegistry || null;
    this.keywordManager = keywordManager || null;
    this.customWidgetFactories = customWidgetFactories || {};
    this.dialogueViews = {};
    this.conditionContext = {};
    // Set post-construction by engine.js (mirrors `shell.runActivity`), so
    // component interaction events (plan §4.2 onClick/onChange/...) reach
    // the exact same ActivityExecutionService as every other Activity.
    this.runWidgetEvent = null;
    this.frames = new Map(); // instanceId -> WindowFrame
    this.runtimeRoots = new Map(); // instanceId -> mutable runtime widget tree
    this.runtimeComponentSeq = 0;
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

  refreshIcons() {
    if (this.iconManager) this._renderIcons();
  }

  _renderIcons() {
    // Keep the Start menu in lockstep with reorder/label/icon edits made by
    // the same DesktopIconManager; it must not maintain a second app list.
    const icons = this.iconManager.list({ includeEngineOwned: true });
    this.taskbar.setApps(icons, (icon) => this.runIconBlueprint?.(icon));
    renderDesktopIcons(this.iconsEl, icons, {
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

  _runtimeState(windowId) {
    const state = this.windowManager.getByWindowId(windowId) || this.windowManager.get(windowId);
    return state ? { state, root: this.runtimeRoots.get(state.instanceId) } : null;
  }

  addWindowComponent({ windowId, parentId = "root", componentId, componentType = "container", maxCount = null, properties = {}, events = {} } = {}) {
    const runtime = this._runtimeState(windowId);
    if (!runtime?.root) return { ok: false, reason: "window-not-open" };
    const parent = this._findWidget(runtime.root, parentId);
    if (!parent || !Array.isArray(parent.children)) return { ok: false, reason: "parent-not-found" };
    const className = properties.className || "";
    if (maxCount != null && className && parent.children.filter((child) => child.className === className).length >= Number(maxCount)) {
      return { ok: false, reason: "component-limit", maxCount: Number(maxCount) };
    }
    const id = componentId || `runtime-component-${++this.runtimeComponentSeq}`;
    const inheritedEvents = Object.keys(events).length ? events : parent.children.find((child) => child.className === className)?.events || {};
    const component = { widgetId: id, id, type: componentType, ...properties, events: inheritedEvents };
    parent.children.push(component);
    this.frames.get(runtime.state.instanceId)?._rerenderRoot();
    this.eventBus.emit("window:component-added", { windowId: runtime.state.windowId, componentId: id });
    return { ok: true, componentId: id };
  }

  removeWindowComponent({ windowId, componentId } = {}) {
    const runtime = this._runtimeState(windowId);
    if (!runtime?.root || !componentId) return { ok: false, reason: "invalid-component" };
    if (!this._removeWidget(runtime.root, componentId)) return { ok: false, reason: "component-not-found" };
    this.frames.get(runtime.state.instanceId)?._rerenderRoot();
    this.eventBus.emit("window:component-removed", { windowId: runtime.state.windowId, componentId });
    return { ok: true, componentId };
  }

  getWindowLayout({ windowId } = {}) {
    const runtime = this._runtimeState(windowId);
    return runtime?.root ? structuredClone(runtime.root) : null;
  }

  getRuntimeRoot(windowId) {
    return this._runtimeState(windowId)?.root || null;
  }

  _findWidget(root, widgetId) {
    if (root?.widgetId === widgetId || root?.id === widgetId) return root;
    for (const child of root?.children || []) {
      const found = this._findWidget(child, widgetId);
      if (found) return found;
    }
    return null;
  }

  _removeWidget(root, widgetId) {
    const index = (root.children || []).findIndex((child) => child.widgetId === widgetId || child.id === widgetId);
    if (index >= 0) { root.children.splice(index, 1); return true; }
    return (root.children || []).some((child) => this._removeWidget(child, widgetId));
  }

  _mountFrame(instanceId) {
    const state = this.windowManager.get(instanceId);
    if (!state) return;
    const definition = this.windowDefinitionStore.get(state.windowId);
    const runtimeRoot = structuredClone(definition?.root || null);
    this.runtimeRoots.set(instanceId, runtimeRoot);
    this._ensureDialogueViews(definition?.root);
    const rendererCtx = {
      variableStore: this.variableStore,
      pvGateway: this.pvGateway,
      dbGateway: this.dbGateway,
      runtimeGateway: this.runtimeGateway,
      saveManager: this.saveManager,
      gameClock: this.gameClock,
      eventBus: this.eventBus,
      dialogueViews: this.dialogueViews,
      valueGraph: definition?.valueGraph,
      conditionContext: this.conditionContext,
      onEvent: (node, eventName, value) => this.runWidgetEvent?.(state.windowId, node.widgetId, eventName, value),
    };
    // Match the last working NG implementation: the generic dialogue window
    // owns one persistent dialogue surface as its body. Rendering it through
    // a declarative wrapper can move/collapse the receiver element while the
    // first Activity event is being emitted, leaving a blank window.
    const dialogueBody = state.windowId === "dialogue" ? this.dialogueViews["his-app"]?.el : null;
    if (dialogueBody) this.dialogueViews["his-app"].reset();
    // A window's title (like its widget properties) may be a bound value
    // instead of a fixed literal ("窗口属性...也都可以通过蓝图指定"); this
    // only affects the rendered titlebar text, never `WindowManager`'s own
    // state.title (which stays the plain literal/fallback used for the
    // taskbar and singleInstance lookups).
    const title = resolvePropertyValue(definition?.title, rendererCtx, state.title);
    const frame = new WindowFrame(this.windowManager, this.eventBus, { ...state, title }, dialogueBody || definition?.body, dialogueBody ? null : runtimeRoot, rendererCtx);
    this.frames.set(instanceId, frame);
    this.windowLayerEl.appendChild(frame.el);
  }

  _ensureDialogueViews(node) {
    if (!node) return;
    if (node.type === "dialogue") {
      const target = node.displayTo || "dialogue";
      const aliases = node.displayAliases || [];
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] ensure dialogue view", { widgetId: node.widgetId, target, aliases, existing: Boolean(this.dialogueViews[target]) });
      /* DEV-TOOLS:END */
      if (!this.dialogueViews[target]) {
        const DialogueWidget = this.customWidgetFactories.dialogue;
        if (!DialogueWidget) return;
        this.dialogueViews[target] = new DialogueWidget({
          eventBus: this.eventBus,
          variableStore: this.variableStore,
          keywordManager: this.keywordManager,
          gameClock: this.gameClock,
          displayReceiverRegistry: this.dialogueRegistry,
          displayTo: target,
          displayAliases: aliases,
        });
      }
      this.dialogueViews[target].addAliases?.(aliases);
      aliases.forEach((alias) => { this.dialogueViews[alias] = this.dialogueViews[target]; });
    }
    (node.children || []).forEach((child) => this._ensureDialogueViews(child));
  }

  _unmountFrame(instanceId) {
    const frame = this.frames.get(instanceId);
    if (!frame) return;
    frame.dispose();
    this.frames.delete(instanceId);
    this.runtimeRoots.delete(instanceId);
  }
}

export default DesktopShell;
