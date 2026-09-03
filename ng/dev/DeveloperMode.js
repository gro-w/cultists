// DEV-TOOLS:START
import { createActivityListManagerModel } from "./ActivityListManagerModel.js";
import { ActivityListManagerView } from "./ActivityListManagerView.js";
import { ActivityEditorView } from "./ActivityEditorView.js";

const LIST_MANAGER_WINDOW_ID = "dev-activity-list-manager";
let editorWindowSeq = 0;

/**
 * DeveloperMode - top-level controller wired into ng/engine.js only when
 * isDevEntry() is true (plan §3.1 strict `?dev` gate). Reads existing game
 * data the same way the engine does - plain fetch("data/...") - never
 * through the dev-server API, which is write-only (per repository
 * decision). Writing back to disk is done exclusively via devApi's
 * writeDataFile(), called from the list manager / editor views.
 */
export async function initDeveloperMode({ engineConfig, windowManager, windowDefinitionStore }) {
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

  return {
    model,
    openListManager: () => windowManager.open(windowDefinitionStore.get(LIST_MANAGER_WINDOW_ID)),
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

export function buildDeveloperDesktopIcon() {
  return { windowId: LIST_MANAGER_WINDOW_ID, glyph: "🛠", label: "开发者工具" };
}

export default initDeveloperMode;
// DEV-TOOLS:END
