import assert from "node:assert/strict";
import fs from "node:fs";
import RuntimeCollectionRegistry from "../core/RuntimeCollectionRegistry.js";

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const manifest = read("data/activity-manifest.json");
const dataFiles = read("data/data-files.json").files;
const ids = manifest.activityIds.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length, "Activity manifest IDs must be unique");
for (const entry of manifest.activityIds) {
  assert.ok(fs.existsSync(`data/activities/${entry.file}`), `missing activity ${entry.file}`);
}
const patients = read("data/databases/patients.json").patients;
const contexts = read("data/databases/patientDialogueContexts.json").patientDialogueContexts;
const symptoms = read("data/databases/symptoms.json").symptoms;
const keywords = read("data/databases/keywords.json").keywords;
assert.equal(patients.length, 57);
assert.equal(contexts.length, patients.length);
assert.equal(symptoms.length, 196);
assert.deepEqual(new Set(symptoms.map(({ id }) => id)), new Set(keywords.filter(({ id }) => id.startsWith("symptom_")).map(({ id }) => id)));
for (const patient of patients) {
  assert.ok(ids.includes(patient.dialogueActivityId), `missing dialogue activity ${patient.id}`);
}
const aliases = {
  patient_lin_ruoqing_01: "work01a-patient1",
  patient_01_02_kidney_stone: "work01a-patient2",
  patient_01_03_benign_prostatic_hyperplasia: "work01a-patient3",
  patient_01_04_nausea_vomiting: "work01a-patient4",
  patient_01_05_lymphadenopathy: "work01a-patient5",
  patient_01_06_orthostatic_hypotension: "work01a-patient6",
  patient_01_07_closed_foot_fracture: "work01a-patient7",
};
for (const [legacyId, targetId] of Object.entries(aliases)) {
  const activity = read(`data/activities/${legacyId}.json`);
  assert.equal(activity.blueprint.nodes.run.inputs.activityId, targetId);
  assert.ok(ids.includes(legacyId));
  assert.ok(dataFiles.includes(`activities/${legacyId}.json`));
}
assert.ok(read("data/game-manifest.json").eventRoutes.some(({ event }) => event === "ending:triggered"));
const specialEvents = read("data/databases/specialEvents.json").specialEvents;
const specialEventActivityIds = read("data/activity-lists/special-event.json").activityIds;
const specialEventManifestIds = new Set(manifest.activityIds.map(({ id }) => id));
assert.equal(specialEvents.filter(({ activityId }) => activityId).length, 9);
assert.equal(specialEvents.filter(({ activityId }) => !activityId).length, 2);
for (const event of specialEvents) {
  if (event.activityId) {
    assert.ok(specialEventActivityIds.includes(event.activityId), `special event list missing ${event.activityId}`);
    assert.ok(specialEventManifestIds.has(event.activityId), `special event manifest missing ${event.activityId}`);
  }
}
const runtime = new RuntimeCollectionRegistry();
runtime.loadDefinitions(read("data/framework-runtime.framework.json").collections);
runtime.restore({ achievementStates: { developer_mode: { unlocked: true } } });
assert.deepEqual(runtime.snapshot().achievementStates, { force_end_work: { unlocked: true } });
console.log(`game-content migration probe: ok (${patients.length} patients, ${symptoms.length} symptoms, ${Object.keys(aliases).length} legacy aliases, ${specialEvents.length} special events)`);
