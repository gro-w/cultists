import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { GameClock } from "../core/GameClock.js";
import { VariableStore } from "../core/VariableStore.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { WindowManager } from "../core/WindowManager.js";
import { DesktopIconManager } from "../core/DesktopIconManager.js";
import { KeywordManager } from "../core/KeywordManager.js";
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";
import { SaveManager } from "../core/SaveManager.js";

// A branch/blockUntil Activity that consumes time once, then waits forever
// for an "approved" variable - used to exercise "等待中的 Activity...一致"
// (plan §13 Phase 7 acceptance).
const waitingDefinition = {
  id: "waiting",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      spendTime: { id: "spendTime", type: "consumeTime", inputs: { minutes: 20 } },
      wait: { id: "wait", type: "blockUntil", inputs: { key: "approved", equals: true } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "spendTime", toPort: "flowIn" },
      { fromNodeId: "spendTime", fromPort: "flowOut", toNodeId: "wait", toPort: "flowIn" },
      { fromNodeId: "wait", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  },
};

function makeSession() {
  const eventBus = new EventBus();
  const gameClock = new GameClock(eventBus);
  const variableStore = new VariableStore(eventBus);
  const publicVariableManager = new PublicVariableManager(null, eventBus);
  publicVariableManager.loadDefinitions([
    { id: 1, name: "playerSan", type: "integer", persistent: true, defaultValue: 100 },
  ]);
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.register({ id: "note", fields: [{ id: "text", type: "string" }] });
  dataStructureManager.register({ id: "keyword", fields: [{ id: "id", type: "string" }, { id: "content", type: "string" }] });
  const dataStore = new DataStore(dataStructureManager);
  dataStore.registerDatabase({ databaseId: "notes", recordType: "note" });
  dataStore.registerDatabase({ databaseId: "keywords", recordType: "keyword" });
  dataStore.createRecord("keywords", { id: "fever", content: "发热" });
  const activityDefinitionStore = new ActivityDefinitionStore();
  activityDefinitionStore.register(waitingDefinition);
  const activityQueueRegistry = new ActivityQueueRegistry();
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const windowManager = new WindowManager(eventBus, { storage: { getItem: () => null, setItem: () => {} } });
  const desktopIconManager = new DesktopIconManager();
  const keywordManager = new KeywordManager({ dataStore, eventBus });

  function runActivity(activityId, queueId = "main") {
    const queue = activityQueueRegistry.get(queueId);
    const definition = activityDefinitionStore.get(activityId);
    if (!queue || !definition) return null;
    const instance = queue.append({ activityId });
    activityExecutionService.run({
      queue,
      definition,
      instance,
      variableStore,
      timeGateway: (minutes) => gameClock.advance(minutes),
      dbGateway: dataStore,
      pvGateway: publicVariableManager,
    });
    return instance;
  }

  function resumePendingActivities() {
    activityQueueRegistry.list().forEach((queue) => {
      const instance = queue.current();
      if (!instance) return;
      const definition = activityDefinitionStore.get(instance.activityId);
      if (!definition) return;
      activityExecutionService.run({
        queue,
        definition,
        instance,
        variableStore,
        timeGateway: (minutes) => gameClock.advance(minutes),
        dbGateway: dataStore,
        pvGateway: publicVariableManager,
      });
    });
  }

  const saveManager = new SaveManager({
    gameClock,
    variableStore,
    publicVariableManager,
    dataStore,
    activityQueueRegistry,
    windowManager,
    desktopIconManager,
    keywordManager,
    activityExecutionService,
    resumePendingActivities,
  });

  return {
    eventBus, gameClock, variableStore, publicVariableManager, dataStructureManager, dataStore,
    activityDefinitionStore, activityQueueRegistry, activityExecutionService, windowManager,
    desktopIconManager, keywordManager, saveManager, runActivity,
  };
}

// --- round trip: new/save/refresh/load state stays consistent ---------------
{
  const session = makeSession();
  session.gameClock.advance(90); // Day 1 01:30
  session.publicVariableManager.set(1, 42);
  session.dataStore.createRecord("notes", { id: "n1", text: "hello" });
  session.windowManager.open({ id: "inventory", title: "Inventory", width: 300, height: 200 });
  session.desktopIconManager.register({ iconId: "icon-a", blueprintId: "desktop.open-window", inputs: { windowId: "inventory" } });
  session.keywordManager.collect("fever", 1);
  const instance = session.runActivity("waiting");

  // Waiting mid-flow before saving.
  assert.equal(session.activityQueueRegistry.get("main").get(instance.instanceId).status, "unresolved");
  assert.equal(session.activityQueueRegistry.get("main").get(instance.instanceId).waitingNodeId, "wait");

  const saved = session.saveManager.snapshot();
  assert.equal(saved.format, "cultists-ng-save");
  assert.equal(saved.version, 2);
  assert.equal(saved.createdAtGameTime, 110);

  // Fresh "reloaded" session, as if the page refreshed.
  const restoredSession = makeSession();
  let terminalCount = 0;
  restoredSession.eventBus.on(ACTIVITY_EVENTS.completed, () => { terminalCount += 1; });
  restoredSession.saveManager.restore(saved);

  assert.deepEqual(restoredSession.gameClock.snapshot(), { day: 1, minutes: 110 });
  assert.equal(restoredSession.publicVariableManager.get(1), 42);
  assert.deepEqual(restoredSession.dataStore.getRecord("notes", "n1"), { id: "n1", text: "hello" });
  const restoredWindow = restoredSession.windowManager.getByWindowId("inventory");
  assert.ok(restoredWindow, "window instance must survive restore");
  assert.equal(restoredWindow.width, 300);
  assert.deepEqual(restoredSession.desktopIconManager.list().map((icon) => icon.iconId), ["icon-a"]);
  assert.ok(restoredSession.keywordManager.has("fever"), "collected keyword must survive restore");
  assert.equal(restoredSession.keywordManager.get("fever").collectedDay, 1);

  // The waiting Activity instance resumed automatically (single post-restore
  // scan) and is still correctly blocked - object identity/consistency
  // across restore (plan §13 Phase 7 acceptance).
  const restoredInstance = restoredSession.activityQueueRegistry.get("main").get(instance.instanceId);
  assert.equal(restoredInstance.status, "unresolved");
  assert.equal(restoredInstance.waitingNodeId, "wait");
  assert.equal(terminalCount, 0);

  // Satisfying the wait condition now resumes to completion exactly once.
  restoredSession.variableStore.set("approved", true);
  assert.equal(restoredSession.activityQueueRegistry.get("main").get(instance.instanceId).status, "resolved");
  assert.equal(terminalCount, 1);
}

// --- a corrupt/invalid save must not overwrite current valid state ----------
{
  const session = makeSession();
  session.gameClock.advance(60);
  session.publicVariableManager.set(1, 7);
  const before = session.saveManager.snapshot();

  assert.throws(() => session.saveManager.restore(null), /valid object/);
  assert.throws(() => session.saveManager.restore({ format: "something-else" }), /Unknown save format/);
  assert.throws(() => session.saveManager.restore({ format: "cultists-ng-save", version: 999 }), /Unsupported save version/);
  assert.throws(() => session.saveManager.restore({ format: "cultists-ng-save", version: 2 }), /missing state/);

  // A structurally-valid-looking envelope with an internally-inconsistent
  // window snapshot (duplicate instanceId) must roll back cleanly.
  const bad = session.saveManager.snapshot();
  bad.state.windows = [
    { instanceId: "dup", windowId: "a" },
    { instanceId: "dup", windowId: "b" },
  ];
  assert.throws(() => session.saveManager.restore(bad), /duplicate/i);

  // None of the failed restores mutated the live session's state.
  assert.deepEqual(session.gameClock.snapshot(), { day: 1, minutes: 60 });
  assert.equal(session.publicVariableManager.get(1), 7);
  assert.deepEqual(session.saveManager.snapshot().state.windows, before.state.windows);
}

// --- re-entrant restore is rejected instead of racing ------------------------
{
  const session = makeSession();
  const saved = session.saveManager.snapshot();
  session.saveManager._restoring = true;
  assert.throws(() => session.saveManager.restore(saved), /already in progress/);
  session.saveManager._restoring = false;
}

console.log("save-manager-probe: all scenarios passed");
