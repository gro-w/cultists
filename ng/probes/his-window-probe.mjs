// Phase 8 HIS window probe: proves `ng/data/windows/his.json` (the HIS
// window's `onCreate` lifecycle blueprint + every widget's inline event
// blueprint) actually runs end-to-end against a real DataStore seeded from
// `data/structures.json`/`data/databases.json`/`data/seed-records.json` -
// patient roster load, patient selection, diagnosis/medicine pick,
// prescription build-up, submit (creates a `medicalCases` record judged
// against the patient's `correctDiagnosisId`), and the "开始问诊" button
// resolving the selected patient's `dialogueActivityId` dynamically
// through the value-node graph (no domain-specific engine code touched;
// this only exercises the generic node set + widget-tree wiring).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../data");
const readJSON = (relPath) => JSON.parse(fs.readFileSync(path.join(dataDir, relPath), "utf8"));

const dataStructureManager = new DataStructureManager();
dataStructureManager.loadDefinitions(readJSON("structures.json"));
const dataStore = new DataStore(dataStructureManager);
dataStore.loadDefinitions(readJSON("databases.json"));
dataStore.loadRecordSet(readJSON("seed-records.json"));

const his = readJSON("windows/his.json");

const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
const activityQueueRegistry = new ActivityQueueRegistry();
const queue = activityQueueRegistry.register("test", { nonBlocking: true });
const activityExecutionService = new ActivityExecutionService(eventBus);

let lastActivityGatewayCall = null;
function runBlueprint(blueprint, label) {
  const { ok, errors, blueprint: normalized } = validateBlueprint(blueprint);
  assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  const instance = queue.append({ activityId: label });
  return activityExecutionService.run({
    queue,
    definition: { id: label, blueprint: normalized },
    instance,
    variableStore,
    timeGateway: () => {},
    windowGateway: () => {},
    activityGateway: (activityId, queueId) => { lastActivityGatewayCall = { activityId, queueId }; },
    eventGateway: () => {},
    dbGateway: dataStore,
    pvGateway: null,
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

// --- every inline blueprint on the window is structurally valid ----------
{
  const blueprints = [["window.onCreate", his.events.onCreate]];
  (function collect(node, prefix) {
    if (!node) return;
    for (const [name, bp] of Object.entries(node.events || {})) if (bp) blueprints.push([`${prefix}.${name}`, bp]);
    for (const child of node.children || []) collect(child, `${prefix}>${child.widgetId}`);
  })(his.root, "root");
  for (const [label, bp] of blueprints) {
    const { ok, errors } = validateBlueprint(bp);
    assert.equal(ok, true, `${label}: ${errors?.join("；")}`);
  }
  assert.ok(blueprints.length >= 7, "expected onCreate + 6 widget event blueprints");
}

// --- onCreate loads the roster + reference data into variableStore -------
runBlueprint(his.events.onCreate, "onCreate");
assert.equal(variableStore.get("his:patients").length, 7);
assert.ok(variableStore.get("his:diagnoses").length > 0);
assert.ok(variableStore.get("his:medicines").length > 0);
assert.equal(variableStore.get("his:selectedPatient"), null);

// --- selecting a patient from the list loads the full record + resets state
const firstPatient = variableStore.get("his:patients")[0];
variableStore.set("event:value", firstPatient.id);
runBlueprint(findWidget(his.root, "his-patient-list").events.onItemClick, "onItemClick");
assert.equal(variableStore.get("his:selectedPatient").id, firstPatient.id);
assert.equal(variableStore.get("his:diagnosisChoice"), "");
assert.deepEqual(variableStore.get("his:prescribedMedicineIds"), []);

// --- "开始问诊" resolves the selected patient's dialogueActivityId dynamically
runBlueprint(findWidget(his.root, "his-start-dialogue").events.onClick, "startDialogue");
assert.equal(lastActivityGatewayCall.activityId, firstPatient.dialogueActivityId);
assert.ok(lastActivityGatewayCall.activityId, "dialogueActivityId must be non-empty");

// --- diagnosis/medicine pick + prescription build-up ----------------------
const correctDiagnosisId = firstPatient.correctDiagnosisId;
variableStore.set("event:value", correctDiagnosisId);
runBlueprint(findWidget(his.root, "his-diagnosis-select").events.onChange, "diagnosisChange");
assert.equal(variableStore.get("his:diagnosisChoice"), correctDiagnosisId);

const someMedicineId = variableStore.get("his:medicines")[0].id;
variableStore.set("event:value", someMedicineId);
runBlueprint(findWidget(his.root, "his-medicine-select").events.onChange, "medicineChange");
runBlueprint(findWidget(his.root, "his-add-medicine").events.onClick, "addMedicine");
assert.deepEqual(variableStore.get("his:prescribedMedicineIds"), [someMedicineId]);

// --- submit creates a medicalCases record, correctly judged as `correct` -
runBlueprint(findWidget(his.root, "his-submit").events.onClick, "submit");
const lastCase = variableStore.get("his:lastCase");
assert.equal(lastCase.patientId, firstPatient.id);
assert.equal(lastCase.diagnosisId, correctDiagnosisId);
assert.deepEqual(lastCase.prescribedMedicineIds, [someMedicineId]);
assert.equal(lastCase.correct, true, "choosing the patient's own correctDiagnosisId must judge as correct");
assert.equal(dataStore.getRecord("medicalCases", lastCase.id).id, lastCase.id);
assert.ok(variableStore.get("his:resultMessage").length > 0);

// --- an incorrect diagnosis is judged as such -----------------------------
{
  const secondPatient = variableStore.get("his:patients")[1];
  variableStore.set("event:value", secondPatient.id);
  runBlueprint(findWidget(his.root, "his-patient-list").events.onItemClick, "onItemClick2");
  const wrongDiagnosisId = variableStore.get("his:diagnoses").find((d) => d.id !== secondPatient.correctDiagnosisId).id;
  variableStore.set("event:value", wrongDiagnosisId);
  runBlueprint(findWidget(his.root, "his-diagnosis-select").events.onChange, "diagnosisChange2");
  runBlueprint(findWidget(his.root, "his-submit").events.onClick, "submit2");
  assert.equal(variableStore.get("his:lastCase").correct, false);
}

console.log("his-window-probe: ok");
