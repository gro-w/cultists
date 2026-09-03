import { EventBus } from "./core/EventBus.js";
import { DataStore } from "./core/DataStore.js";
import { WindowManager } from "./core/WindowManager.js";
import { DesktopShell } from "./core/DesktopShell.js";
import { EngineState } from "./core/EngineState.js";
import { SchemaRegistry } from "./core/SchemaRegistry.js";
import { ActivityDefinitionStore } from "./core/ActivityDefinitionStore.js";
import { createDefaultNodeRegistry } from "./core/ActivityNodeRegistry.js";
import { ActivityValidator } from "./core/ActivityValidator.js";
import { ActivityQueueRegistry } from "./core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "./core/ActivityExecutionService.js";
import { PublicVariableManager } from "./core/PublicVariableManager.js";
import { DataStructureManager } from "./core/DataStructureManager.js";
import { SaveManager } from "./core/SaveManager.js";
import { DesktopIconManager } from "./core/DesktopIconManager.js";

const clockToMinutes = (value) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
const minutesToClock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

async function boot() {
  const eventBus = new EventBus();
  const engineState = new EngineState();
  const schemas = new SchemaRegistry();
  const store = new DataStore();
  const config = await store.loadJSON("engine.json");
  const variables = new PublicVariableManager(eventBus);
  for (const definition of await store.loadJSON("variables.json")) variables.register(definition);
  const structures = new DataStructureManager(eventBus);
  for (const definition of await store.loadJSON("structures.json")) structures.register(definition);
  for (const database of await store.loadJSON("databases.json")) { structures.createDatabase(database.databaseId, database.recordType); for (const record of database.records || []) structures.insert(database.databaseId, record); }
  const definitions = new ActivityDefinitionStore();
  const nodes = createDefaultNodeRegistry();
  const validator = new ActivityValidator(nodes);
  const activityLists = await Promise.all((config.activityLists || ["default"]).map(async (id) => store.loadJSON(`activity-lists/${id}.json`)));
  for (const activityId of config.activities || []) { const definition = await store.loadJSON(`activities/${activityId}.json`); validator.assert(definition); definitions.register(definition); }
  const queues = new ActivityQueueRegistry(eventBus);
  queues.register({ queueId: "main", displayName: "主要队列", mode: "serial", autoStart: true });
  const effects = { setVariable: (node) => variables.set(node.data.variableId, node.data.value), consumeTime: (node) => { engineState.gameTime += Number(node.data.minutes || 0); }, emitEvent: (node) => eventBus.emit(node.data.event, { source: "activity" }) };
  const execution = new ActivityExecutionService({ definitions, queues, nodes, eventBus, effects });
  const windowManager = new WindowManager(document.querySelector("#window-layer"), eventBus);
  for (const windowId of config.windows || []) windowManager.register(await store.loadJSON(`windows/${windowId}.json`));
  const shell = new DesktopShell({ iconRoot: document.querySelector("#desktop-icons"), windowManager, taskList: document.querySelector("#task-list"), eventBus });
  const iconManager = new DesktopIconManager({ root: document.querySelector("#desktop-icons"), windowManager, eventBus });
  iconManager.setIcons(await store.loadJSON("desktop-icons.json"));
  const minutes = clockToMinutes(config.initialClock || "08:00");
  document.querySelector("#taskbar-clock").textContent = minutesToClock(minutes);
  // DEV-TOOLS:START
  const desktopLabel = document.querySelector("#desktop-label");
  const developerMode = globalThis.location?.search === "?dev";
  desktopLabel.textContent = developerMode ? "开发人员模式开启" : "开发人员模式未开启";
  desktopLabel.hidden = false;
  // DEV-TOOLS:END
  document.querySelector("#start-button").addEventListener("click", () => windowManager.open("off-duty-demo"));
  const save = new SaveManager({ state: engineState, variables, structures, queues, windows: windowManager, eventBus });
  engineState.setLifecycle("activating");
  const initial = execution.create({ definitionId: "default", queueId: "main" });
  execution.start(initial);
  engineState.setLifecycle("ready");
  schemas.register("activity", (value) => validator.validate(value));
  // DEV-TOOLS:START
  const openDeveloperWindow = async () => {
    const existing = [...windowManager.instances.values()].find((frame) => frame.definition.id === "developer-mode");
    if (existing) { windowManager.focus(existing.windowInstanceId); return existing; }
    const host = document.createElement("div");
    const frame = windowManager.openDynamic({ id: "developer-mode", title: "开发人员模式", content: host, width: 900, height: 680, x: 40, y: 30 });
    try { const { DeveloperMode } = await import("./editors/DeveloperMode.js"); new DeveloperMode({ definitions, validator, variables, structures, windowManager, store, state: engineState, queues, nodes, activityLists }).mount(host); } catch (error) { host.textContent = `开发人员模式加载失败：${error.message}`; console.error(error); }
    return frame;
  };
  if (developerMode) {
    const developerIcon = document.createElement("button");
    developerIcon.className = "desktop-icon";
    developerIcon.innerHTML = "<span class=desktop-icon-logo>🛠️</span><span>开发人员模式</span>";
    developerIcon.addEventListener("dblclick", openDeveloperWindow);
    document.querySelector("#desktop-icons").append(developerIcon);
    openDeveloperWindow();
  }
  // DEV-TOOLS:END
  window.cultistsNG = { eventBus, store, shell, iconManager, windowManager, state: { clockMinutes: minutes }, engineState, schemas, definitions, nodes, validator, queues, execution, variables, structures, save };
  eventBus.emit("engine:ready", { engineName: config.engineName, version: config.engineVersion });
}

boot().catch((error) => { console.error("cultists NG boot failed", error); document.body.dataset.engineError = "true"; });
