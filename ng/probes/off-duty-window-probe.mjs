// Phase 8 off-duty/dorm probe: proves `ng/data/windows/off-duty.json` now
// renders the dorm roommate-interaction UI (per legacy's hardcoded
// NPC_IDS = ["ajie","awei","binbin"] -> favorability public-variable ids
// 40/41/42, SAN ids 60/61/62 convention) instead of the placeholder
// title+hint. Covers: onCreate loads each roommate's `npcs` record, the
// widget-tree `valueGraph` correctly derives per-roommate name/avatar and
// "好感度：N"/"SAN：N" display text from those records + public variables,
// and each roommate's "交流" button produces a placeholder chat message
// (no social dialogue Activities are migrated into ng/ yet).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { PublicVariableManager } from "../core/PublicVariableManager.js";
import { RuntimeRefResolver } from "../core/RuntimeRefResolver.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { OnboardingManager } from "../core/OnboardingManager.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../data");
const readJSON = (relPath) => JSON.parse(fs.readFileSync(path.join(dataDir, relPath), "utf8"));

const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(readJSON("structures.json"));
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(readJSON("databases.json"));
dataStore.loadRecordSet(readJSON("seed-records.json"));

const refResolver = new RuntimeRefResolver();
const eventBus = new EventBus();
const publicVariableManager = new PublicVariableManager(refResolver, eventBus);
publicVariableManager.loadDefinitions(readJSON("public-variables.json"));

const variableStore = new VariableStore(eventBus);
const activityQueueRegistry = new ActivityQueueRegistry();
const queue = activityQueueRegistry.register("test", { nonBlocking: true });
const activityExecutionService = new ActivityExecutionService(eventBus);
const onboardingManager = new OnboardingManager({ eventBus });

let consumedMinutes = 0;
function runBlueprint(blueprint, label) {
  const { ok, errors, blueprint: normalized } = validateBlueprint(blueprint);
  assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  const instance = queue.append({ activityId: label });
  return activityExecutionService.run({
    queue,
    definition: { id: label, blueprint: normalized },
    instance,
    variableStore,
    timeGateway: (minutes) => { consumedMinutes += minutes; },
    windowGateway: () => {},
    activityGateway: () => {},
    eventGateway: () => {},
    dbGateway: dataStore,
    pvGateway: publicVariableManager,
    onboardingGateway: onboardingManager,
  });
}

function findWidget(root, widgetId) {
  if (!root) return null;
  if (root.widgetId === widgetId) return root;
  for (const child of root.children || []) {
    const found = findWidget(child, widgetId);
    if (found) return found;
  }
  return null;
}

const offDuty = readJSON("windows/off-duty.json");
const ROOMMATES = [
  { npcId: "ajie", name: "阿杰", favId: 40, sanId: 60 },
  { npcId: "awei", name: "阿伟", favId: 41, sanId: 61 },
  { npcId: "binbin", name: "彬彬", favId: 42, sanId: 62 },
];

// --- every inline blueprint is structurally valid -------------------------
{
  const blueprints = [["window.onCreate", offDuty.events.onCreate]];
  (function collect(node, prefix) {
    if (!node) return;
    for (const [name, bp] of Object.entries(node.events || {})) if (bp) blueprints.push([`${prefix}.${name}`, bp]);
    for (const child of node.children || []) collect(child, `${prefix}>${child.widgetId}`);
  })(offDuty.root, "root");
  assert.equal(blueprints.length, 1 + ROOMMATES.length, "expected onCreate + one interact blueprint per roommate");
  for (const [label, bp] of blueprints) {
    const { ok, errors } = validateBlueprint(bp);
    assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  }
}

// --- onCreate loads each roommate's npc record and resets the message ----
runBlueprint(offDuty.events.onCreate, "onCreate");
for (const { npcId } of ROOMMATES) {
  const record = variableStore.get(`dorm:npc${ROOMMATES.findIndex((r) => r.npcId === npcId)}`);
  assert.equal(record.id, npcId);
}
assert.equal(variableStore.get("dorm:message"), "");
assert.equal(consumedMinutes, 480, "off-duty period should still consume the full night, as before");

// --- valueGraph derives correct display text for every roommate ----------
for (const { npcId, name, favId, sanId } of ROOMMATES) {
  const evalNode = (nodeId) => evaluateValueOutput(offDuty.valueGraph, nodeId, "value", variableStore, new Set(), publicVariableManager);
  assert.equal(evalNode(`${npcId}Name`), name);
  assert.equal(evalNode(`${npcId}FavText`), `好感度：${publicVariableManager.get(favId)}`);
  assert.equal(evalNode(`${npcId}SanText`), `SAN：${publicVariableManager.get(sanId)}`);
}

// --- clicking "交流" sets a per-roommate placeholder message --------------
for (const { npcId, name } of ROOMMATES) {
  const button = findWidget(offDuty.root, `off-duty-${npcId}-interact`);
  assert.ok(button, `missing interact button for ${npcId}`);
  runBlueprint(button.events.onClick, `interact-${npcId}`);
  const message = variableStore.get("dorm:message");
  assert.ok(message.startsWith(name), `message should be attributed to ${name}: ${message}`);
}

console.log("off-duty-window-probe: ok");
