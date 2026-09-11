import assert from "node:assert/strict";
import fs from "node:fs";
import { getActivityNodeDefinition, getActivityNodePort, ACTIVITY_NODE_TYPES } from "../js/core/ActivityNodeRegistry.js";
import { validateBlueprint } from "../js/core/ActivityBlueprint.js";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { ActivityRunner } = await import("../js/core/ActivityRunner.js");

const controls = {
  __prerequisite__: { id: "__prerequisite__", type: "prerequisite", inputs: { condition: true }, outputs: {} },
  __activity_expiry__: { id: "__activity_expiry__", type: "activityExpiry", inputs: { expires: false, expiresAt: 0 }, outputs: {} },
};

function makeBlueprint(n) {
  const nodes = {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    random: { id: "random", type: "randomBranch", inputs: { n }, outputs: {} },
    ...controls,
  };
  const connections = [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "random", toPort: "flowIn" }];
  for (let index = 0; index < n; index += 1) {
    const branchId = `branch${index}`;
    const endId = `end${index}`;
    nodes[branchId] = { id: branchId, type: "text", inputs: { speaker: "npc", text: `branch-${index}` }, outputs: {} };
    nodes[endId] = { id: endId, type: "activityEnd", inputs: {}, outputs: {} };
    connections.push(
      { fromNodeId: "random", fromPort: `flowOut${index}`, toNodeId: branchId, toPort: "flowIn" },
      { fromNodeId: branchId, fromPort: "flowOut", toNodeId: endId, toPort: "flowIn" },
    );
  }
  return { startNodeId: "start", nodes, connections };
}

assert.ok(ACTIVITY_NODE_TYPES.includes("randomBranch"));
assert.deepEqual(getActivityNodeDefinition("randomBranch"), {
  label: "随机分支",
  flowInputs: [{ name: "flowIn", kind: "flow", type: null }],
  flowOutputs: [{ name: "default", kind: "flow", type: null }],
  valueInputs: [{ name: "n", kind: "value", type: "number" }],
});
const randomNode = { id: "random", type: "randomBranch", inputs: { n: 3 }, outputs: {} };
assert.equal(getActivityNodePort("randomBranch", "flowIn", "input", randomNode).kind, "flow");
assert.equal(getActivityNodePort("randomBranch", "n", "input", randomNode).type, "number");
assert.deepEqual([0, 1, 2].map((index) => getActivityNodePort("randomBranch", `flowOut${index}`, "output", randomNode)?.name), ["flowOut0", "flowOut1", "flowOut2"]);
assert.equal(getActivityNodePort("randomBranch", "flowOut3", "output", randomNode), null);

for (const [n, expectedIndexes] of [[1, [0]], [3, [0, 1, 2]]]) {
  const blueprint = makeBlueprint(n);
  assert.equal(validateBlueprint(blueprint).ok, true, validateBlueprint(blueprint).errors.join("；"));
  for (const [randomValue, expectedIndex] of [[0, expectedIndexes[0]], [0.4, expectedIndexes[Math.min(1, expectedIndexes.length - 1)]], [0.999999, expectedIndexes.at(-1)]]) {
    const instance = { status: "unresolved", transcript: [] };
    new ActivityRunner({ definition: { id: `random-${n}`, blueprint }, instance, random: () => randomValue }).start();
    assert.equal(instance.status, "resolved");
    assert.equal(instance.lastRandomBranch.index, expectedIndex);
    assert.equal(instance.lastRandomBranch.count, n);
  }
}

const invalidBlueprint = makeBlueprint(1);
invalidBlueprint.nodes.random.inputs.n = 0;
assert.equal(validateBlueprint(invalidBlueprint).ok, false);
const missingN = makeBlueprint(1);
delete missingN.nodes.random.inputs.n;
const invalidInstance = { status: "unresolved", transcript: [] };
const invalidRunner = new ActivityRunner({ definition: { id: "random-invalid", blueprint: missingN }, instance: invalidInstance, random: () => 0 });
assert.throws(() => invalidRunner.start(), /Random branch count n/);

const editorSource = fs.readFileSync(new URL("../js/desktop/DevDialogueEditorTab.js", import.meta.url), "utf8");
assert.match(editorSource, /node\.type === 'randomBranch' && direction === 'output'/);
assert.match(editorSource, /node\.type === 'randomBranch' && name === 'n'/);
console.log("random branch probe: ok");
