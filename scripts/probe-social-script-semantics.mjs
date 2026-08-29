import assert from "node:assert/strict";
import fs from "node:fs";
import { validateBlueprint } from "../js/core/ScheduleBlueprint.js";

const root = "data/zh-hans";
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8"));
const ids = (file) => read(file).entries.map((entry) => entry.id);
const get = (file, id) => read(file).entries.find((entry) => entry.id === id);
const allEntries = [
  ...read("social01a.json").entries,
  ...read("social01b.json").entries,
  ...read("social02a.json").entries,
  ...read("social02b.json").entries,
  ...read("social03a.json").entries,
  ...read("social03b.json").entries,
  ...read("social04a.json").entries,
  ...read("social04b.json").entries,
];

assert.deepEqual(ids("social01a.json"), []);
assert.deepEqual(ids("social01b.json"), ["social01b_ajie_honor_of_kings", "social01b_awei_headphones"]);
assert.deepEqual(ids("social02a.json"), ["social01a_ajie_chat", "social01a_awei_chat"]);
assert.deepEqual(ids("social03a.json"), []);
assert.deepEqual(ids("social03b.json"), [
  "social02b_ajie_24_personality_high",
  "social02b_ajie_24_personality_low",
  "social02b_awei_tail_high",
  "social02b_awei_tail_low",
]);
assert.deepEqual(ids("social04a.json"), ["social02a_ajie_chat", "social02a_awei_chat"]);
assert.deepEqual(ids("social04b.json"), []);

for (const entry of allEntries) {
  const result = validateBlueprint(entry.blueprint);
  assert.equal(result.ok, true, `${entry.id}: ${result.errors?.join("; ")}`);
}

function control(entry, type) {
  return Object.values(entry.blueprint.nodes).find((node) => node.type === type);
}
function incoming(entry, nodeId, port) {
  return entry.blueprint.connections.find((item) => item.toNodeId === nodeId && item.toPort === port);
}
function assertGlobalGate(entry, variableId) {
  const prerequisite = control(entry, "prerequisite");
  const edge = incoming(entry, prerequisite.id, "condition");
  assert.ok(edge, `${entry.id}: missing prerequisite input edge`);
  const seen = new Set();
  const visit = (nodeId) => {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const node = entry.blueprint.nodes[nodeId];
    if (!node) return false;
    if (node.type === "getGlobal") return node.inputs.variableId === variableId;
    return entry.blueprint.connections
      .filter((item) => item.toNodeId === nodeId)
      .some((item) => visit(item.fromNodeId));
  };
  assert.equal(visit(edge.fromNodeId), true, `${entry.id}: missing public variable ${variableId} in prerequisite graph`);
}

assertGlobalGate(get("social02a.json", "social01a_ajie_chat"), 100);
assertGlobalGate(get("social02a.json", "social01a_awei_chat"), 101);
assertGlobalGate(get("social04a.json", "social02a_ajie_chat"), 100);
assertGlobalGate(get("social04a.json", "social02a_awei_chat"), 101);
for (const id of ["social02b_ajie_24_personality_high", "social02b_ajie_24_personality_low"]) assertGlobalGate(get("social03b.json", id), 40);
for (const id of ["social02b_awei_tail_high", "social02b_awei_tail_low"]) assertGlobalGate(get("social03b.json", id), 41);

for (const entry of allEntries) {
  const expiry = control(entry, "scheduleExpiry");
  assert.equal(expiry.inputs.expires, true);
  assert.equal(Number.isInteger(expiry.inputs.expiresAt), true);
}
assert.equal(get("social01b.json", "social01b_awei_headphones").blueprint.nodes.choice12_op0.inputs.variableId, 41);
assert.equal(get("social02a.json", "social01a_awei_chat").blueprint.nodes.choice6_op1_suspicion.inputs.delta, 5);
assert.equal(get("social04a.json", "social02a_awei_chat").blueprint.nodes.choice5_op1.inputs.delta, 5);
assert.equal(get("social03b.json", "social02b_ajie_24_personality_high").blueprint.nodes.choice_final_25_op1.inputs.delta, 5);
assert.equal(get("social03b.json", "social02b_awei_tail_low").blueprint.nodes.choice_final_23_op0_suspicion.inputs.delta, -5);
console.log(`social script semantics probe: ok (${allEntries.length} entries)`);
