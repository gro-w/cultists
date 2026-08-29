import assert from "node:assert/strict";
import fs from "node:fs";

const registry = fs.readFileSync("js/core/ScheduleNodeRegistry.js", "utf8");
const runner = fs.readFileSync("js/core/ScheduleRunner.js", "utf8");
const scheduleData = fs.readFileSync("js/core/ScheduleData.js", "utf8");
const hisApp = fs.readFileSync("js/apps/HISApp.js", "utf8");
const data = JSON.parse(fs.readFileSync("data/zh-hans/workpub.json", "utf8"));
const template = data.entries.find((entry) => entry.id === "medical_incident_work");
assert.ok(template, "public medical work template missing");
assert.ok(!registry.includes("medicalIncident"), "medical settlement node must be retired");
assert.ok(registry.includes("ending:"), "generic ending node missing");
assert.ok(runner.includes('case "ending"'), "generic ending runtime missing");
assert.ok(!runner.includes('case "medicalIncident"'), "medical settlement runtime must be retired");
assert.ok(scheduleData.includes("向愤怒的患者解释"), "complaint choice label missing");
assert.ok(scheduleData.includes("riotLargeSuccess"), "riot generic consequence path missing");
assert.ok(hisApp.includes("renderMedicalIncident"), "medical incidents must use the HIS choice UI");
const { blueprint } = template;
const { nodes, connections } = blueprint;
assert.equal(nodes.random.type, "randomBranch");
assert.equal(nodes.explain.type, "choice");
assert.equal(nodes.check.type, "diceCheck");
assert.equal(nodes.fine.type, "setGlobal");
assert.equal(nodes.fine.inputs.variableId, 2);
assert.equal(nodes.doubleFine.inputs.variableId, 2);
assert.match(nodes.fineText.inputs.text, /罚款了100元/);
assert.match(nodes.doubleFineText.inputs.text, /罚款了200元/);
assert.ok(!nodes.death, "complaint template should not contain riot-only death node");
assert.equal(Object.values(nodes).filter((node) => node.type === "scheduleEnd").length, 1);
for (const port of ["flowOut0", "flowOut1", "flowOut2"]) {
  assert.ok(connections.some((edge) => edge.fromNodeId === "random" && edge.fromPort === port));
}
assert.ok(connections.some((edge) => edge.fromNodeId === "explain" && edge.fromPort === "option0" && edge.toNodeId === "check"));
assert.ok(connections.some((edge) => edge.fromNodeId === "skill" && edge.fromPort === "value" && edge.toNodeId === "check"));
for (const port of ["largeSuccess", "success", "failure", "largeFailure"]) {
  assert.ok(connections.some((edge) => edge.fromNodeId === "check" && edge.fromPort === port));
}
console.log("medical schedule migration probe: ok");
