// Phase 8 slice: the remaining 6 of `work01a.json`'s 7 patients (only
// patient 1 was wired in the earlier "first playable slice"), batch
// converted via the existing `migrate-legacy-blueprint.mjs#convertBlueprint`
// tool (0 blocked node types, same as patient 1) into
// `work01a-patient{2..7}.json` + `-start.json` wrapper pairs, added to
// `ng/data/activity-lists/default.json`, and seeded into the `patients`
// database (`ng/data/seed-records.json`) with the legacy `age`/
// `correctDiagnosisId`/`diagnosisOptionIds` fields the new HIS window's
// diagnosis judging reads. This probe proves every one of the 7 patient
// blueprints (+ its start wrapper) validates cleanly and that every
// patient's `dialogueActivityId` resolves to a real, registered Activity.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activitiesDir = path.join(__dirname, "../data/activities");
const seedRecords = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/seed-records.json"), "utf8"));
const defaultList = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/activity-lists/default.json"), "utf8"));

function loadDefinition(fileName) {
  const raw = JSON.parse(fs.readFileSync(path.join(activitiesDir, fileName), "utf8"));
  const { ok, errors, blueprint } = validateBlueprint(raw.blueprint);
  assert.equal(ok, true, `${fileName}: ${errors.join(", ")}`);
  return { ...raw, blueprint };
}

// --- all 7 patient + start-wrapper blueprints validate cleanly --------------
const store = new ActivityDefinitionStore();
for (let slot = 1; slot <= 7; slot++) {
  const patient = loadDefinition(`work01a-patient${slot}.json`);
  const start = loadDefinition(`work01a-patient${slot}-start.json`);
  store.register(patient);
  store.register(start);
  assert.ok(defaultList.activityIds.includes(patient.id), `default list should include ${patient.id}`);
  assert.ok(defaultList.activityIds.includes(start.id), `default list should include ${start.id}`);
}

// --- 7 seeded patient records, each with a resolvable dialogueActivityId ---
assert.equal(seedRecords.patients.length, 7, "all 7 work01a patients seeded");
for (const patient of seedRecords.patients) {
  assert.ok(patient.correctDiagnosisId, `${patient.id} needs a correctDiagnosisId`);
  assert.ok(patient.diagnosisOptionIds.length >= 2, `${patient.id} needs >=2 diagnosis options`);
  assert.ok(patient.diagnosisOptionIds.includes(patient.correctDiagnosisId), `${patient.id}'s correct diagnosis must be among its options`);
  assert.ok(store.get(patient.dialogueActivityId), `${patient.id}'s dialogueActivityId "${patient.dialogueActivityId}" must resolve to a registered Activity`);
}

// --- every patient's diagnosis options resolve against the seeded diagnoses database ---
const diagnosisIds = new Set((seedRecords.diagnoses || []).map((d) => d.id));
for (const patient of seedRecords.patients) {
  for (const diagnosisId of patient.diagnosisOptionIds) {
    assert.ok(diagnosisIds.has(diagnosisId), `${patient.id}'s option "${diagnosisId}" must exist in the diagnoses database`);
  }
}

console.log("work01a-remaining-patients-probe: all scenarios passed");
