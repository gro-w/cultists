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
 * Multiple distinct desktop icons for dev mode (plan item 5: "开发人员模式
 * 里面有多个图标，activity管理器只是其中一个") - the Activity 列表管理器 is
 * only one of several dev-tool entry points, alongside the Debugger.
 */
export function buildDeveloperDesktopIcons() {
  return [
    { windowId: LIST_MANAGER_WINDOW_ID, glyph: "🛠", label: "Activity 管理器" },
    { windowId: DEBUGGER_WINDOW_ID, glyph: "🐞", label: "活动调试器" },
    { windowId: WINDOW_MANAGER_WINDOW_ID, glyph: "🪟", label: "窗口编辑器" },
  ];
}

export default initDeveloperMode;
// DEV-TOOLS:END
