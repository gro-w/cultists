// Phase 8 "playable slice" probe: proves the first real migrated content
// (`ng/data/activities/work01a-patient1.json`, converted verbatim from
// `data/zh-hans/work01a.json`'s first `his` patient entry via
// `migrate-legacy-blueprint.mjs`) actually runs end-to-end through the
// exact same gateway wiring `engine.js` uses - `openWindow` fires the
// generic "dialogue" window, `text`/`choice` nodes emit `dialogue:text`/
// `dialogue:choice`, and a player picking the first option every time
// reaches `activityEnd` having consumed the expected in-game minutes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activitiesDir = path.join(__dirname, "../data/activities");

function loadDefinition(fileName) {
  const raw = JSON.parse(fs.readFileSync(path.join(activitiesDir, fileName), "utf8"));
  const { ok, errors, blueprint } = validateBlueprint(raw.blueprint);
  assert.equal(ok, true, `${fileName}: ${errors.join(", ")}`);
  return { ...raw, blueprint };
}

const startDefinition = loadDefinition("work01a-patient1-start.json");
const patientDefinition = loadDefinition("work01a-patient1.json");

const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
const activityDefinitionStore = new ActivityDefinitionStore();
activityDefinitionStore.register(startDefinition);
activityDefinitionStore.register(patientDefinition);
const activityQueueRegistry = new ActivityQueueRegistry();
activityQueueRegistry.register("desktop-icons", { nonBlocking: true });
const activityExecutionService = new ActivityExecutionService(eventBus);

let minutesConsumed = 0;
const openedWindows = [];
const dialogueEvents = [];

function runActivity(activityId, queueId = "main") {
  const queue = activityQueueRegistry.get(queueId);
  const definition = activityDefinitionStore.get(activityId);
  const instance = queue.append({ activityId });
  return activityExecutionService.run({
    queue,
    definition,
    instance,
    variableStore,
    timeGateway: (minutes) => { minutesConsumed += minutes; },
    windowGateway: (windowId) => openedWindows.push(windowId),
    activityGateway: (id, activityQueueId) => runActivity(id, activityQueueId || "main"),
    eventGateway: (eventName, payload) => {
      if (eventName.startsWith("dialogue:")) dialogueEvents.push({ eventName, payload });
    },
  });
}

runActivity("work01a-patient1-start", "desktop-icons");

// The wrapper activity itself resolves immediately (openWindow + runActivity
// are both non-blocking flow steps); the patient dialogue instance it kicked
// off on "main" is the one actually waiting on player input.
const mainQueue = activityQueueRegistry.get("main");
const patientInstance = mainQueue.current();
assert.ok(patientInstance, "expected the patient dialogue instance to be running on the main queue");
assert.equal(openedWindows[0], "dialogue", "expected the generic dialogue window to be opened first");

// Drive the conversation exactly like a player clicking "继续"/the first
// choice every time, until the Activity resolves.
let guard = 0;
while (patientInstance.status !== "resolved" && guard++ < 100) {
  const node = patientDefinition.blueprint.nodes[patientInstance.waitingNodeId];
  assert.ok(node, `unexpected wait with no node: ${patientInstance.waitingNodeId}`);
  if (node.type === "text") variableStore.set(node.inputs.continueKey, true);
  else if (node.type === "choice") variableStore.set(node.inputs.selectionKey, 0);
  else assert.fail(`unexpected waiting node type: ${node.type}`);
}

assert.equal(patientInstance.status, "resolved");
assert.equal(minutesConsumed, 80, "expected the 4 consumeTime nodes on the all-first-option path to total 80 minutes");
// text/choice re-emit on each wait re-check (same as blockUntil, see
// dialogue-node-probe.mjs), so a waited node fires twice: once entering the
// wait, once on the wake that satisfies it.
assert.equal(dialogueEvents.filter((e) => e.eventName === "dialogue:text").length, 8);
assert.equal(dialogueEvents.filter((e) => e.eventName === "dialogue:choice").length, 4);
assert.ok(dialogueEvents.every((e) => e.payload.instanceId === patientInstance.instanceId), "every dialogue event should carry the running instance's id");

console.log("work01a-patient1-probe: all scenarios passed");
