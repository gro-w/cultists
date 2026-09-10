// DEV-TOOLS:START
import { createActivityListManagerModel } from "./ActivityListManagerModel.js";
import { ActivityListManagerView } from "./ActivityListManagerView.js";
import { ActivityEditorView } from "./ActivityEditorView.js";
import { ActivityDebuggerView } from "./ActivityDebuggerView.js";
import { WindowDefinitionManagerView } from "./WindowDefinitionManagerView.js";
import { WindowEditorView } from "./WindowEditorView.js";
import { DesktopIconEditorView } from "./DesktopIconEditorView.js";
import { DataStructureEditorView } from "./DataStructureEditorView.js";
import { DatabaseEditorView } from "./DatabaseEditorView.js";
import { PublicVariableEditorView } from "./PublicVariableEditorView.js";
import { PublicVariableDebuggerView } from "./PublicVariableDebuggerView.js";
import { OnboardingEditorView } from "./OnboardingEditorView.js";
import { StartMenuEditorView } from "./StartMenuEditorView.js";
import { SaveDebuggerView } from "./SaveDebuggerView.js";
import { BlueprintNodeManagerView } from "./BlueprintNodeManagerView.js";
import { DataJsonEditorView } from "./DataJsonEditorView.js";
import { updateCustomActivityNode } from "../core/ActivityNodeRegistry.js";



const LIST_MANAGER_WINDOW_ID = "dev-activity-list-manager";
const DEBUGGER_WINDOW_ID = "dev-activity-debugger";
const WINDOW_MANAGER_WINDOW_ID = "dev-window-definition-manager";
const ICON_EDITOR_WINDOW_ID = "dev-desktop-icon-editor";
const STRUCTURE_MANAGER_WINDOW_ID = "dev-structure-manager";
const DATABASE_EDITOR_WINDOW_ID = "dev-database-editor";
const PUBLIC_VARIABLE_MANAGER_WINDOW_ID = "dev-public-variable-manager";
const PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID = "dev-public-variable-debugger";
const ONBOARDING_EDITOR_WINDOW_ID = "dev-onboarding-editor";
const START_MENU_EDITOR_WINDOW_ID = "dev-start-menu-editor";
const SAVE_DEBUGGER_WINDOW_ID = "dev-save-debugger";
const BLUEPRINT_NODE_MANAGER_WINDOW_ID = "dev-blueprint-node-manager";
const DATA_JSON_EDITOR_WINDOW_ID = "dev-data-json-editor";

const LAUNCHER_WINDOW_ID = "dev-mode-launcher";
let editorWindowSeq = 0;
let windowEditorWindowSeq = 0;
let widgetEventEditorSeq = 0;

/**
 * DeveloperMode - top-level controller wired into ng/engine.js only when
 * isDevEntry() is true (plan §3.1 strict `?dev` gate). Reads existing game
 * data through the same DataLoader boundary as the engine - never
 * through the dev-server API, which is write-only (per repository
 * decision). Writing back to disk is done exclusively via devApi's
 * writeDataFile(), called from the list manager / editor views.
 */
export async function initDeveloperMode({
  engineConfig,
  activityManifest,
  windowManager,
  windowDefinitionStore,
  activityQueueRegistry,
  activityDefinitionStore,
  eventBus,
  variableStore,
  pvGateway,
  dbGateway,
  runtimeGateway,
  iconManager,
  dataStructureManager,
  dataStore,
  publicVariableManager,
  eventStateRegistry,
  dataLoader,
  saveManager,
  customBlueprintNodes = [],
  forceEndWork = null,

  refreshIcons,
}) {
  const model = createActivityListManagerModel();
  const dataFileManifest = await dataLoader.loadJSON("data-files.json", { cache: false });

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
  // Developer mode must not hold desktop mounting on the complete Activity
  // editor corpus. Populate the already-created manager in the background.
  loadExistingActivities(model, engineConfig, activityManifest, dataLoader, dataFileManifest?.files || [])
    .then(() => listManagerView.render())
    .catch((error) => console.error("Developer Activity loading failed", error));
  windowDefinitionStore.register({
    id: LIST_MANAGER_WINDOW_ID,
    title: "Activity 列表管理器",
    icon: "📦",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: listManagerView.el,
  });

  // The debugger only needs live runtime pieces (queue registry + event
  // bus), so it's fine to build it even if the caller doesn't pass them in
  // (e.g. an older bootstrap ordering); it just shows an empty queue list.
  const debuggerView = new ActivityDebuggerView({ activityQueueRegistry, activityDefinitionStore, eventBus });
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

  const saveDebuggerView = new SaveDebuggerView({ saveManager });
  windowDefinitionStore.register({
    id: SAVE_DEBUGGER_WINDOW_ID,
    title: "存档调试器",
    icon: "💾",
    width: 760,
    height: 560,
    resizable: true,
    singleInstance: true,
    body: saveDebuggerView.el,
  });

  function openWindowEditor(definition) {
    const windowId = `dev-window-editor-${definition.id}-${windowEditorWindowSeq++}`;
    const view = new WindowEditorView({
      definition,
      dataFileName: `windows/${definition.id}.json`,
      onSaveToMemory: (updated) => windowDefinitionStore.register(updated),
      variableStore,
      pvGateway,
      dbGateway,
      runtimeGateway,
      openEventBlueprintEditor: openWidgetEventEditor,
      openValueBlueprintEditor: openWidgetValueEditor,
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

  function openWidgetValueEditor({ blueprint, displayName, onSaveToMemory } = {}) {
    const windowId = `dev-widget-value-editor-${widgetEventEditorSeq++}`;
    const view = new ActivityEditorView({
      activityId: windowId,
      blueprint,
      displayName,
      onSaveToMemory,
    });
    const definition = windowDefinitionStore.register({
      id: windowId,
      title: `组件数值蓝图 - ${displayName || "untitled"}`,
      icon: "🔢",
      width: 980,
      height: 620,
      resizable: true,
      singleInstance: false,
      body: view.el,
    });
    windowManager.open(definition);
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

  // Data structure manager (plan §9.2) - visual editor for structures.framework.json,
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
  const databaseEditorView = new DatabaseEditorView({ dataStore, dataStructureManager, dataLoader });
  windowDefinitionStore.register({
    id: DATABASE_EDITOR_WINDOW_ID,
    title: "数据库编辑器",
    icon: "🗄",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: databaseEditorView.el,
  });

  // Public variable manager (plan §10.2) - visual editor for
  // public-variables.framework.json, shared with the live PublicVariableManager so a
  // public-variable debugger opened afterwards immediately sees any schema
  // change (mirrors DataStructureEditorView's editor/debugger split).
  const publicVariableEditorView = new PublicVariableEditorView({ publicVariableManager });
  windowDefinitionStore.register({
    id: PUBLIC_VARIABLE_MANAGER_WINDOW_ID,
    title: "公共变量管理器",
    icon: "🌐",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: publicVariableEditorView.el,
  });

  // Public variable debugger - runtime value browser/editor for the live
  // PublicVariableManager, always going through its set/setObjectRef API
  // (never a direct Map mutation), never writing back to a data file.
  const publicVariableDebuggerView = new PublicVariableDebuggerView({ publicVariableManager });
  windowDefinitionStore.register({
    id: PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID,
    title: "公共变量调试器",
    icon: "🧮",
    width: 640,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: publicVariableDebuggerView.el,
  });

  // Onboarding hint editor (Phase 8 新手引导) - visual editor for
  // onboarding.json, shared with the live OnboardingManager so a "预览"
  // click immediately re-shows a hint through the real TutorialOverlay.
  const onboardingEditorView = new OnboardingEditorView({ eventStateRegistry });
  windowDefinitionStore.register({
    id: ONBOARDING_EDITOR_WINDOW_ID,
    title: "新手引导编辑器",
    icon: "💡",
    width: 480,
    height: 420,
    resizable: true,
    singleInstance: true,
    body: onboardingEditorView.el,
  });

  const startMenuEditorView = new StartMenuEditorView({ iconManager });
  windowDefinitionStore.register({
    id: START_MENU_EDITOR_WINDOW_ID,
    title: "开始菜单编辑器",
    icon: "📋",
    width: 420,
    height: 360,
    resizable: true,
    singleInstance: true,
    body: startMenuEditorView.el,
  });

  function openBlueprintNodeEditor(node) {
    const view = new ActivityEditorView({
      activityId: `blueprint-node-${node.id}`,
      blueprint: node.blueprint,
      displayName: node.label || node.id,
      onSaveToMemory: (blueprint) => {
        node.blueprint = blueprint;
        updateCustomActivityNode(node);
        blueprintNodeManagerView.render();
      },
    });
    const definition = windowDefinitionStore.register({
      id: `dev-blueprint-node-editor-${node.id}`,
      title: `蓝图节点编辑器 - ${node.label || node.id}`,
      icon: "🔷",
      width: 980,
      height: 620,
      resizable: true,
      singleInstance: true,
      body: view.el,
    });
    windowManager.open(definition);
  }

  const blueprintNodeManagerView = new BlueprintNodeManagerView({ nodes: customBlueprintNodes, openEditor: openBlueprintNodeEditor });
  windowDefinitionStore.register({
    id: BLUEPRINT_NODE_MANAGER_WINDOW_ID,
    title: "蓝图节点管理器",
    icon: "🔷",
    width: 760,
    height: 520,
    resizable: true,
    singleInstance: true,
    body: blueprintNodeManagerView.el,
  });

  const dataJsonEditorView = new DataJsonEditorView({
    dataLoader,
    dataFiles: dataFileManifest?.files || [],
  });
  windowDefinitionStore.register({
    id: DATA_JSON_EDITOR_WINDOW_ID,
    title: "全部 JSON 数据编辑器",
    icon: "🗃",
    width: 1040,
    height: 680,
    resizable: true,
    singleInstance: true,
    body: dataJsonEditorView.el,
  });


  // Single desktop-icon entry point (plan follow-up: "把桌面上各个开发人员
  // 模式图标放在同一个开发人员模式app里面") - every dev sub-tool above is
  // still its own singleInstance window, just launched from one shared
  // launcher window instead of one desktop icon each. The launcher is
  // The upper section owns JSON-backed authoring and disk persistence. The
  // lower section owns live runtime/save state; its mutations never write a
  // source JSON document.
  const launcherEl = document.createElement("div");
  launcherEl.className = "ng-dev-launcher";
  launcherEl.innerHTML = `
    <div class="ng-dev-launcher-section">
      <h4>编辑器（JSON 数据，可存盘）</h4>
      <button type="button" data-tool="list-manager">🛠 Activity 管理器</button>
      <button type="button" data-tool="window-manager">🪟 窗口编辑器</button>
      <button type="button" data-tool="icon-editor">🖱 桌面图标编辑器</button>
      <button type="button" data-tool="structure-manager">🧱 数据结构管理器</button>
      <button type="button" data-tool="database-debugger">🗄 数据库编辑器</button>
      <button type="button" data-tool="public-variable-manager">🌐 公共变量管理器</button>
      <button type="button" data-tool="onboarding-editor">💡 新手引导编辑器</button>
      <button type="button" data-tool="start-menu-editor">📋 开始菜单编辑器</button>
      <button type="button" data-tool="blueprint-node-manager">🔷 蓝图节点管理器</button>
      <button type="button" data-tool="data-json-editor">🗃 全部 JSON 数据编辑器</button>

    </div>
    <div class="ng-dev-launcher-section">
      <h4>调试器（运行时 / 存档状态）</h4>
      <button type="button" data-tool="debugger">🐞 活动调试器</button>
      <button type="button" data-tool="save-debugger">💾 存档调试器</button>
      <button type="button" data-tool="public-variable-debugger">🧮 公共变量调试器</button>
      <button type="button" data-tool="force-end-work">⏩ 强制下班</button>
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
    windowManager.open(windowDefinitionStore.get(DATABASE_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="public-variable-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="onboarding-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(ONBOARDING_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="start-menu-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(START_MENU_EDITOR_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="blueprint-node-manager"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(BLUEPRINT_NODE_MANAGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="data-json-editor"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(DATA_JSON_EDITOR_WINDOW_ID));
  });

  launcherEl.querySelector('[data-tool="save-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(SAVE_DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="public-variable-debugger"]').addEventListener("click", () => {
    windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID));
  });
  launcherEl.querySelector('[data-tool="force-end-work"]').addEventListener("click", () => {
    forceEndWork?.();
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
    openDatabaseDebugger: () => windowManager.open(windowDefinitionStore.get(DATABASE_EDITOR_WINDOW_ID)),
    openSaveDebugger: () => windowManager.open(windowDefinitionStore.get(SAVE_DEBUGGER_WINDOW_ID)),
    openPublicVariableManager: () => windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_MANAGER_WINDOW_ID)),
    openPublicVariableDebugger: () => windowManager.open(windowDefinitionStore.get(PUBLIC_VARIABLE_DEBUGGER_WINDOW_ID)),
    openOnboardingEditor: () => windowManager.open(windowDefinitionStore.get(ONBOARDING_EDITOR_WINDOW_ID)),
    openBlueprintNodeManager: () => windowManager.open(windowDefinitionStore.get(BLUEPRINT_NODE_MANAGER_WINDOW_ID)),
    openDataJsonEditor: () => windowManager.open(windowDefinitionStore.get(DATA_JSON_EDITOR_WINDOW_ID)),

  };
}

async function loadExistingActivities(model, engineConfig, activityManifest, dataLoader, dataFiles = []) {
  const manifestEntries = new Map(
    (activityManifest?.activityIds || []).map((entry) => [entry.id, entry]),
  );
  const listFiles = Array.isArray(engineConfig?.activityLists) ? engineConfig.activityLists : [];
  for (const listFile of listFiles) {
    const list = await dataLoader.loadJSON(`activity-lists/${listFile}`, { optional: true });
    if (!list) continue;
    model.registerList(list);
    for (const activityId of list.activityIds || []) {
      const manifestEntry = manifestEntries.get(activityId);
      if (!manifestEntry?.file) continue;
      const definition = await dataLoader.loadJSON(`activities/${manifestEntry.file}`, { optional: true });
      if (!definition) continue;
      model.registerActivity(list.id, definition, definition);
    }
  }

  // Every activity JSON has a dedicated ActivityEditorView, even when the
  // activity is not referenced by a player-facing activity list.
  const allActivitiesListId = "__all-activities__";
  model.registerList({ id: allActivitiesListId, activityIds: [] });
  for (const file of dataFiles.filter((path) => path.startsWith("activities/") && path.endsWith(".json"))) {
    const fileName = file.slice("activities/".length);
    const definition = await dataLoader.loadJSON(file, { optional: true });
    if (!definition) continue;
    const id = definition.id || fileName.slice(0, -5);
    model.registerActivity(allActivitiesListId, { ...definition, id }, definition);
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
    glyph: "🛠️",
    label: "开发人员模式",
    blueprintId: "desktop.open-window",
    inputs: { windowId: LAUNCHER_WINDOW_ID },
  }];
}

export default initDeveloperMode;
// DEV-TOOLS:END
