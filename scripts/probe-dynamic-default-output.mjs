import assert from "node:assert/strict";
import fs from "node:fs";

const globals = JSON.parse(fs.readFileSync("data/zh-hans/global_variables.json", "utf8"));
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { globalVariableManager } = await import("../js/core/GlobalVariableManager.js");
const { getActivityNodeDefinition, getActivityNodePort } = await import("../js/core/ActivityNodeRegistry.js");
const { validateBlueprint } = await import("../js/core/ActivityBlueprint.js");
const { ActivityRunner } = await import("../js/core/ActivityRunner.js");
globalVariableManager.replaceDefinitions(globals, { emit: false });
globalVariableManager.set(5, 2, { emit: false });

function makeBlueprint() {
  const nodes = {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    getN: { id: "getN", type: "getGlobal", inputs: { variableId: 5 }, outputs: {} },
    random: { id: "random", type: "randomBranch", inputs: { n: { nodeId: "getN", port: "value" } }, outputs: {} },
    chosen: { id: "chosen", type: "text", inputs: { speaker: "npc", text: "chosen" }, outputs: {} },
    fallback: { id: "fallback", type: "text", inputs: { speaker: "npc", text: "fallback" }, outputs: {} },
    endChosen: { id: "endChosen", type: "activityEnd", inputs: {}, outputs: {} },
    endFallback: { id: "endFallback", type: "activityEnd", inputs: {}, outputs: {} },
    prerequisite: { id: "prerequisite", type: "prerequisite", inputs: { condition: true }, outputs: {} },
    expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: false, expiresAt: 0 }, outputs: {} },
  };
  return {
    startNodeId: "start",
    nodes,
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "random", toPort: "flowIn" },
      { fromNodeId: "getN", fromPort: "value", toNodeId: "random", toPort: "n" },
      { fromNodeId: "random", fromPort: "flowOut0", toNodeId: "chosen", toPort: "flowIn" },
      { fromNodeId: "random", fromPort: "default", toNodeId: "fallback", toPort: "flowIn" },
      { fromNodeId: "chosen", fromPort: "flowOut", toNodeId: "endChosen", toPort: "flowIn" },
      { fromNodeId: "fallback", fromPort: "flowOut", toNodeId: "endFallback", toPort: "flowIn" },
    ],
  };
}

assert.equal(getActivityNodeDefinition("randomBranch").flowOutputs[0].name, "default");
assert.equal(getActivityNodeDefinition("choice").flowOutputs[0].name, "default");
assert.equal(getActivityNodeDefinition("segmentBranch").flowOutputs[0].name, "default");
assert.equal(getActivityNodePort("randomBranch", "default", "output").name, "default");
assert.equal(getActivityNodePort("choice", "default", "output").name, "default");
assert.equal(getActivityNodePort("segmentBranch", "default", "output").name, "default");
assert.equal(validateBlueprint(makeBlueprint()).ok, true, validateBlueprint(makeBlueprint()).errors.join("；"));

function run(random) {
  const instance = { status: "unresolved", transcript: [] };
  new ActivityRunner({ definition: { id: "dynamic-default", blueprint: makeBlueprint() }, instance, random }).start();
  return instance;
}
const selected = run(() => 0);
assert.equal(selected.status, "resolved");
assert.equal(selected.lastRandomBranch.count, 2);
assert.equal(selected.lastRandomBranch.index, 0);
assert.match(selected.transcript.find((line) => line.type === "text")?.text || "", /chosen/);

const unmatched = run(() => 0.99);
assert.equal(unmatched.status, "resolved");
assert.equal(unmatched.lastRandomBranch.count, 2);
assert.equal(unmatched.lastRandomBranch.index, 1);
assert.match(unmatched.transcript.find((line) => line.type === "text")?.text || "", /fallback/);

console.log("dynamic default output probe: ok");
