import assert from "node:assert/strict";
import fs from "node:fs";

const registry = fs.readFileSync("js/core/ScheduleNodeRegistry.js", "utf8");
const runner = fs.readFileSync("js/core/ScheduleRunner.js", "utf8");
const scheduleData = fs.readFileSync("js/core/ScheduleData.js", "utf8");
const hisApp = fs.readFileSync("js/apps/HISApp.js", "utf8");
const medicalManager = fs.readFileSync("js/core/MedicalCaseManager.js", "utf8");
const data = JSON.parse(fs.readFileSync("data/zh-hans/workpub.json", "utf8"));

const complaint = data.entries.find((entry) => entry.id === "medical_complaint_work");
const riot = data.entries.find((entry) => entry.id === "medical_riot_work");
assert.ok(complaint, "public complaint work schedule missing");
assert.ok(riot, "public riot work schedule missing");
assert.notEqual(complaint.id, riot.id);
assert.ok(!fs.existsSync("data/zh-hans/medical_events.json"), "legacy medical event data must be removed");
assert.ok(!registry.includes("medicalIncident"), "medical settlement node must be retired");
assert.ok(registry.includes("ending:"), "generic ending node missing");
assert.ok(runner.includes('case "ending"'), "generic ending runtime missing");
assert.ok(!runner.includes('case "medicalIncident"'), "medical settlement runtime must be retired");
assert.ok(medicalManager.includes('globalVariableManager.modify(2, moneyDelta)'), "medical money must use global variable 2");
assert.ok(!medicalManager.includes("this.income +="), "medical manager must not own money balance");
assert.ok(!medicalManager.includes("medical_events.json"), "medical manager must not load legacy event data");
assert.equal(complaint.blueprint.nodes.explain.inputs.label0, "向愤怒的患者解释", "complaint choice label missing");
assert.equal(riot.blueprint.nodes.explain.inputs.label0, "向愤怒的家属解释", "riot choice label missing");
assert.ok(!scheduleData.includes("explain.options[0]"), "medical enqueue must not use legacy choice options");
assert.ok(scheduleData.includes("medical_riot_work"), "riot schedule selection missing");
assert.ok(hisApp.includes("renderMedicalIncident"), "medical incidents must use the HIS choice UI");
const { blueprint } = complaint;
const { nodes, connections } = blueprint;
assert.equal(nodes.random.type, "randomBranch");
assert.equal(nodes.random.inputs.n, 20);
assert.equal(nodes.explain.type, "choice");
assert.equal(nodes.check.type, "diceCheck");
assert.equal(nodes.fine.type, "setGlobal");
assert.equal(nodes.fine.inputs.variableId, 2);
assert.equal(nodes.doubleFine.inputs.variableId, 2);
assert.match(nodes.fineText.inputs.text, /罚款了100元/);
assert.match(nodes.doubleFineText.inputs.text, /罚款了200元/);
assert.ok(!nodes.death, "complaint schedule should not contain riot-only death node");
assert.equal(Object.values(nodes).filter((node) => node.type === "scheduleEnd").length, 1);
for (let index = 0; index < 20; index += 1) {
  const port = `flowOut${index}`;
  assert.ok(connections.some((edge) => edge.fromNodeId === "random" && edge.fromPort === port));
}
assert.ok(connections.some((edge) => edge.fromNodeId === "explain" && edge.fromPort === "option0" && edge.toNodeId === "check"));
assert.ok(connections.some((edge) => edge.fromNodeId === "skill" && edge.fromPort === "value" && edge.toNodeId === "check"));
for (const port of ["largeSuccess", "success", "failure", "largeFailure"]) {
  assert.ok(connections.some((edge) => edge.fromNodeId === "check" && edge.fromPort === port));
}
const riotNodes = riot.blueprint.nodes;
assert.equal(riotNodes.random.inputs.n, 20);
assert.equal(Object.values(riotNodes).filter((node) => node.type === "text" && node.id.startsWith("dialogue")).length, 20);
assert.equal(riotNodes.riotFine.type, "setGlobal");
assert.equal(riotNodes.riotFine.inputs.variableId, 2);
assert.equal(riotNodes.riotLargeSuccess.inputs.variableId, 2);
assert.equal(riotNodes.death.type, "ending");
assert.equal(riotNodes.death.inputs.endingId, "mob_violence_death");
assert.ok(riot.blueprint.connections.some((edge) => edge.toNodeId === "explain" && edge.fromNodeId.startsWith("dialogue")));
console.log("medical schedule migration probe: ok");
