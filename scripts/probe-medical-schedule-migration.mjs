import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { validateBlueprint } = await import("../js/core/ScheduleBlueprint.js");
const { scheduleData } = await import("../js/core/ScheduleData.js");
const { workQueue } = await import("../js/core/ScheduleQueue.js");
const { createScheduleRunner } = await import("../js/core/ScheduleRunner.js");
const { medicalCaseManager } = await import("../js/core/MedicalCaseManager.js");

const template = JSON.parse(fs.readFileSync("data/zh-hans/workpub.json", "utf8")).entries.find((entry) => entry.id === "medical_incident_work");
assert.ok(template, "public medical work template missing");
const validation = validateBlueprint(template.blueprint);
assert.equal(validation.ok, true, validation.errors.join("; "));
const nodes = validation.blueprint.nodes;
assert.equal(nodes.random.type, "randomBranch");
assert.equal(nodes.random.inputs.n, 3);
assert.equal(nodes.check.type, "diceCheck");
assert.equal(nodes.resolve.type, "medicalIncident");
assert.equal(Object.values(nodes).filter((node) => node.type === "scheduleEnd").length, 1);

medicalCaseManager.config = {
  complaintFine: 100,
  riotFine: 300,
  complaintDialogues: ["投诉台词一", "投诉台词二", "投诉台词三"],
};
medicalCaseManager.submissions = new Map([["patient_probe", {
  patientId: "patient_probe", day: 1, dueDay: 2, incidentType: "complaint", processed: false,
}]]);
medicalCaseManager.pendingIncidents = [];
medicalCaseManager.pendingExpenses = 0;
const requests = medicalCaseManager.processDue(2);
assert.equal(requests.length, 1);
assert.deepEqual(requests[0].dialogues, medicalCaseManager.config.complaintDialogues);
assert.equal(medicalCaseManager.pendingIncidents.length, 0, "processDue must not resolve effects directly");

scheduleData.publicEntries.set("work", [template]);
const enqueue = scheduleData.enqueueMedicalIncident(requests[0]);
assert.equal(enqueue.ok, true);
const entry = workQueue.getPending().find((item) => item.scheduleId === enqueue.scheduleId);
assert.ok(entry, "medical incident must be appended to workQueue");
assert.equal(entry.blueprint.nodes.dialogue0.inputs.text, "投诉台词一");
const blueprint = JSON.parse(JSON.stringify(entry.blueprint));
blueprint.connections = blueprint.connections.filter((connection) => !(connection.fromNodeId === "skill" && connection.toNodeId === "check"));
blueprint.nodes.check.inputs.n = 50;
entry.blueprint = blueprint;
const runner = createScheduleRunner({
  definition: entry,
  instance: entry,
  random: (() => { const values = [0, 0.49]; return () => values.shift() ?? 0; })(),
  onCheckpoint: (instance) => workQueue.updateInstance(instance.instanceId, instance),
  onComplete: (instance) => workQueue.complete(instance.instanceId),
});
runner.start();
assert.equal(entry.lastRandomBranch.index, 0);
assert.equal(entry.lastDiceCheck.outcome, "success");
assert.equal(entry.status, "resolved");
assert.equal(medicalCaseManager.pendingExpenses, 0);
assert.equal(medicalCaseManager.pendingIncidents.length, 1);
assert.equal(medicalCaseManager.pendingIncidents[0].type, "complaint");

const complaintFailure = medicalCaseManager.resolveScheduledIncident({
  submission: { patientId: "patient_probe_failure" },
  type: "complaint",
  text: "投诉大失败台词",
  check: { roll: 96, target: 50, outcome: "failure" },
});
assert.equal(complaintFailure.result.fine, 200);
assert.equal(medicalCaseManager.pendingExpenses, 200);

medicalCaseManager.submissions.set("patient_probe_riot", {
  patientId: "patient_probe_riot", day: 1, dueDay: 2, incidentType: "riot", processed: false,
});
medicalCaseManager.config.riotDialogues = ["医闹台词一", "医闹台词二", "医闹台词三"];
const riotRequest = medicalCaseManager.processDue(2).find((request) => request.type === "riot");
assert.deepEqual(riotRequest.dialogues, medicalCaseManager.config.riotDialogues);
const riotEnqueue = scheduleData.enqueueMedicalIncident(riotRequest);
const riotEntry = workQueue.getPending().find((item) => item.scheduleId === riotEnqueue.scheduleId);
const riotBlueprint = JSON.parse(JSON.stringify(riotEntry.blueprint));
riotBlueprint.connections = riotBlueprint.connections.filter((connection) => !(connection.fromNodeId === "skill" && connection.toNodeId === "check"));
riotBlueprint.nodes.check.inputs.n = 50;
riotEntry.blueprint = riotBlueprint;
createScheduleRunner({
  definition: riotEntry,
  instance: riotEntry,
  random: (() => { const values = [0, 0]; return () => values.shift() ?? 0; })(),
  onCheckpoint: (instance) => workQueue.updateInstance(instance.instanceId, instance),
  onComplete: (instance) => workQueue.complete(instance.instanceId),
}).start();
assert.equal(riotEntry.lastDiceCheck.outcome, "largeSuccess");
assert.equal(medicalCaseManager.pendingExpenses, 500);
assert.equal(medicalCaseManager.pendingIncidents.at(-1).result.fine, 300);
console.log("medical schedule migration probe: ok");
