// DEV-TOOLS:START
import { createActivityListManagerModel } from "./ActivityListManagerModel.js";
import { ActivityListManagerView } from "./ActivityListManagerView.js";
import { ActivityEditorView } from "./ActivityEditorView.js";
import { ActivityDebuggerView } from "./ActivityDebuggerView.js";
import { WindowDefinitionManagerView } from "./WindowDefinitionManagerView.js";
import { WindowEditorView } from "./WindowEditorView.js";

const LIST_MANAGER_WINDOW_ID = "dev-activity-list-manager";
const DEBUGGER_WINDOW_ID = "dev-activity-debugger";
const WINDOW_MANAGER_WINDOW_ID = "dev-window-definition-manager";
const LAUNCHER_WINDOW_ID = "dev-mode-launcher";
let editorWindowSeq = 0;
let windowEditorWindowSeq = 0;
let widgetEventEditorSeq = 0;

/**
 * DeveloperMode - top-level controller wired into ng/engine.js only when
 * isDevEntry() is true (plan §3.1 strict `?dev` gate). Reads existing game
 * data the same way the engine does - plain fetch("data/...") - never
 * through the dev-server API, which is write-only (per repository
 * decision). Writing back to disk is done exclusively via devApi's
 * writeDataFile(), called from the list manager / editor views.
 */
export async function initDeveloperMode({ engineConfig, windowManager, windowDefinitionStore, activityQueueRegistry, eventBus, variableStore }) {
  const model = createActivityListManagerModel();
  await loadExistingActivities(model, engineConfig);

  function openEditor(activity) {
    const windowId = `dev-activity-editor-${activity.id}-${editorWindowSeq++}`;
    const view = new ActivityEditorView({
      activityId: activity.id,
      blueprint: activity.blueprint,
      displayName: activity.displayName,
      dataFileName: `activities/${activity.id}.json`,
      onSaveToMemory: (blueprint) => model.saveActivityBlueprint(activity.id, blueprint),
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `Activity 编辑器 - ${activity.displayName}`,
      icon: "🧩",
      width: 860,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const listManagerView = new ActivityListManagerView(model, { openEditor });
  windowDefinitionStore.register({
    id: LIST_MANAGER_WINDOW_ID,
    title: "Activity 列表管理器",
    icon: "🗂",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: listManagerView.el,
  });

  // The debugger only needs live runtime pieces (queue registry + event
  // bus), so it's fine to build it even if the caller doesn't pass them in
  // (e.g. an older bootstrap ordering); it just shows an empty queue list.
  const debuggerView = new ActivityDebuggerView({ activityQueueRegistry, eventBus });
  windowDefinitionStore.register({
    id: DEBUGGER_WINDOW_ID,
    title: "活动调试器",
    icon: "🐞",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: debuggerView.el,
  });

  function openWindowEditor(definition) {
    const windowId = `dev-window-editor-${definition.id}-${windowEditorWindowSeq++}`;
    const view = new WindowEditorView({
      definition,
      dataFileName: `windows/${definition.id}.json`,
      onSaveToMemory: (updated) => windowDefinitionStore.register(updated),
      variableStore,
      openEventBlueprintEditor: openWidgetEventEditor,
    });
    const editorDefinition = windowDefinitionStore.register({
      id: windowId,
      title: `窗口编辑器 - ${definition.id}`,
      icon: "🪟",
      width: 900,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(editorDefinition);
  }

  /**
   * Opens a widget's `events.onClick`/`onChange`/... inline blueprint in the
   * exact same ActivityEditorView used for top-level Activities (plan §4.2
   * "组件交互事件...统一经过 ActivityExecutionService"), so authoring a
   * component's click/change behaviour is no different from authoring any
   * other Activity - same node palette, same visual language, same save
   * flow, just written back into the widget's `events[eventName]` field
   * instead of `data/activities/*.json`.
   */
  function openWidgetEventEditor(blueprint, displayName, onSave) {
    const windowId = `dev-widget-event-editor-${widgetEventEditorSeq++}`;
    const view = new ActivityEditorView({
      activityId: windowId,
      blueprint,
      displayName,
      onSaveToMemory: onSave,
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `事件蓝图 - ${displayName}`,
      icon: "⚡",
      width: 860,
      height: 560,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const windowManagerView = new WindowDefinitionManagerView(windowDefinitionStore.list(), { openEditor: openWindowEditor });
  windowDefinitionStore.register({
    id: WINDOW_MANAGER_WINDOW_ID,
    title: "自定义窗口编辑器",
    icon: "🪟",
    width: 480,
    height: 360,
    resizable: true,
    singleInstance: true,
    body: windowManagerView.el,
  });

  // Single desktop-icon entry point (plan follow-up: "把桌面上各个开发人员
  // 模式图标放在同一个开发人员模式app里面") - every dev sub-tool above is
  // still its own singleInstance window, just launched from one shared
  // launcher window instead of one desktop icon each.
  const launcherEl = document.createElement("div");
  launcherEl.className = "ng-dev-launcher";
  launcherEl.innerHTML = `
    <button type="button" data-tool="list-manager">🛠 Activity 管理器</button>
    <button type="button" data-tool="debugger">🐞 活动调试器</button>
    <button type="button" data-tool="window-manager">🪟 窗口编辑器</button>
  `;
  launcherEl.querySelector('[data-tool="list-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="window-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(WINDOW_MANAGER_WINDOW_ID));
  });
  windowDefinitionStore.register({
    id: LAUNCHER_WINDOW_ID,
    title: "开发人员模式",
    icon: "🛠",
    width: 280,
    height: 200,
    resizable: false,
    singleInstance: true,
    body: launcherEl,
  });

  return {
    model,
    openListManager: () => windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID)),
    openDebugger: () => windowManager.open(windowDefinitionStore.get(DEBUGGER_WINDOW_ID)),
    openWindowManager: () => windowManager.open(windowDefinitionStore.get(WINDOW_MANAGER_WINDOW_ID)),
  };
}

async function loadExistingActivities(model, engineConfig) {
  const listFiles = Array.isArray(engineConfig?.activityLists) ? engineConfig.activityLists : [];
  for (const listFile of listFiles) {
    const response = await fetch(`data/activity-lists/${listFile}`);
    if (!response.ok) continue;
    const list = await response.json();
    model.registerList(list);
    for (const activityId of list.activityIds || []) {
      const activityResponse = await fetch(`data/activities/${activityId}.json`);
      if (!activityResponse.ok) continue;
      const definition = await activityResponse.json();
      model.registerActivity(list.id, definition, definition);
    }
  }
}

/**
 * A single desktop icon opens the shared dev-mode launcher window, which
 * in turn opens each individual dev sub-tool (plan follow-up: consolidate
 * multiple dev-mode desktop icons into one "开发人员模式" app).
 */
export function buildDeveloperDesktopIcons() {
  return [{
    iconId: "dev-mode-launcher-icon",
    glyph: "🛠",
    label: "开发人员模式",
    blueprintId: "desktop.open-window",
    inputs: { windowId: LAUNCHER_WINDOW_ID },
  }];
}

export default initDeveloperMode;
// DEV-TOOLS:END
