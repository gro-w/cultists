// DEV-TOOLS:START
import { createActivityListManagerModel } from "./ActivityListManagerModel.js";
import { ActivityListManagerView } from "./ActivityListManagerView.js";
import { ActivityEditorView } from "./ActivityEditorView.js";
import { ActivityDebuggerView } from "./ActivityDebuggerView.js";
import { WindowDefinitionManagerView } from "./WindowDefinitionManagerView.js";
import { WindowEditorView } from "./WindowEditorView.js";
import { DesktopIconEditorView } from "./DesktopIconEditorView.js";
import { DataStructureEditorView } from "./DataStructureEditorView.js";
import { DatabaseDebuggerView } from "./DatabaseDebuggerView.js";

const LIST_MANAGER_WINDOW_ID = "dev-activity-list-manager";
const DEBUGGER_WINDOW_ID = "dev-activity-debugger";
const WINDOW_MANAGER_WINDOW_ID = "dev-window-definition-manager";
const ICON_EDITOR_WINDOW_ID = "dev-desktop-icon-editor";
const STRUCTURE_MANAGER_WINDOW_ID = "dev-structure-manager";
const DATABASE_DEBUGGER_WINDOW_ID = "dev-database-debugger";
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
export async function initDeveloperMode({
  engineConfig,
  windowManager,
  windowDefinitionStore,
  activityQueueRegistry,
  eventBus,
  variableStore,
  iconManager,
  dataStructureManager,
  dataStore,
  refreshIcons,
}) {
  const model = createActivityListManagerModel();
  await loadExistingActivities(model, engineConfig);

  function openEditor(activity) {
    const windowId = `dev-activity-editor-${activity.id}-${editorWindowSeq++}`;
    let currentId = activity.id;
    const view = new ActivityEditorView({
      activityId: activity.id,
      blueprint: activity.blueprint,
      displayName: activity.displayName,
      dataFileName: `activities/${activity.id}.json`,
      onSaveToMemory: (blueprint) => model.saveActivityBlueprint(currentId, blueprint),
      onRenameId: (oldId, newId) => {
        model.renameActivity(oldId, newId);
        currentId = newId;
        view.dataFileName = `activities/${newId}.json`;
      },
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

  const windowManagerView = new WindowDefinitionManagerView(windowDefinitionStore, { openEditor: openWindowEditor });
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

  // Desktop icon editor (plan §8.2) - edits the live iconManager shared
  // with DesktopShell directly, so drag/order/logo/blueprint edits preview
  // immediately via `refreshIcons`, and persists to desktop-icons.json.
  const iconEditorView = new DesktopIconEditorView({ iconManager, refreshIcons });
  windowDefinitionStore.register({
    id: ICON_EDITOR_WINDOW_ID,
    title: "桌面图标编辑器",
    icon: "🖱",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: iconEditorView.el,
  });

  // Data structure manager (plan §9.2) - visual editor for structures.json,
  // shared with the live DataStructureManager so a database debugger
  // opened afterwards immediately sees any schema change.
  const structureEditorView = new DataStructureEditorView({ dataStructureManager });
  windowDefinitionStore.register({
    id: STRUCTURE_MANAGER_WINDOW_ID,
    title: "数据结构管理器",
    icon: "🧱",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: structureEditorView.el,
  });

  // Database debugger (plan §9.3/§9.4) - runtime record browser/editor for
  // the live DataStore, always going through its createRecord/updateRecord/
  // deleteRecord API (never a direct Map mutation).
  const databaseDebuggerView = new DatabaseDebuggerView({ dataStore });
  windowDefinitionStore.register({
    id: DATABASE_DEBUGGER_WINDOW_ID,
    title: "数据库调试器",
    icon: "🗄",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: databaseDebuggerView.el,
  });

  // Single desktop-icon entry point (plan follow-up: "把桌面上各个开发人员
  // 模式图标放在同一个开发人员模式app里面") - every dev sub-tool above is
  // still its own singleInstance window, just launched from one shared
  // launcher window instead of one desktop icon each. The launcher is
  // split top/bottom (plan follow-up: "开发人员模式窗口分成上下两部分") -
  // the top half only opens editors for game data (data/**.json: Activity
  // 列表、窗口定义、桌面图标、数据结构), the bottom half only opens
  // debuggers for live runtime state (Activity 队列、数据库记录), which
  // also support modification but never write back to a data file.
  const launcherEl = document.createElement("div");
  launcherEl.className = "ng-dev-launcher";
  launcherEl.innerHTML = `
    <div class="ng-dev-launcher-section">
      <h4>游戏数据编辑器</h4>
      <button type="button" data-tool="list-manager">🛠 Activity 管理器</button>
      <button type="button" data-tool="window-manager">🪟 窗口编辑器</button>
      <button type="button" data-tool="icon-editor">🖱 桌面图标编辑器</button>
      <button type="button" data-tool="structure-manager">🧱 数据结构管理器</button>
    </div>
    <div class="ng-dev-launcher-section">
      <h4>运行时数据调试器</h4>
      <button type="button" data-tool="debugger">🐞 活动调试器</button>
      <button type="button" data-tool="database-debugger">🗄 数据库调试器</button>
    </div>
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
  launcherEl.querySelector('[data-tool="icon-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(ICON_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="structure-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(STRUCTURE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="database-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DATABASE_DEBUGGER_WINDOW_ID));
  });
  windowDefinitionStore.register({
    id: LAUNCHER_WINDOW_ID,
    title: "开发人员模式",
    icon: "🛠",
    width: 300,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: launcherEl,
  });

  return {
    model,
    openListManager: () => windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID)),
    openDebugger: () => windowManager.open(windowDefinitionStore.get(DEBUGGER_WINDOW_ID)),
    openWindowManager: () => windowManager.open(windowDefinitionStore.get(WINDOW_MANAGER_WINDOW_ID)),
    openIconEditor: () => windowManager.open(windowDefinitionStore.get(ICON_EDITOR_WINDOW_ID)),
    openStructureManager: () => windowManager.open(windowDefinitionStore.get(STRUCTURE_MANAGER_WINDOW_ID)),
    openDatabaseDebugger: () => windowManager.open(windowDefinitionStore.get(DATABASE_DEBUGGER_WINDOW_ID)),
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
