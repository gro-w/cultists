import { validateBlueprint, embedLegacyPrerequisite } from "../js/core/ActivityBlueprint.js";
import { ActivityValueEvaluator } from "../js/core/ActivityValueEvaluator.js";
import { getActivityNodeDefinition, getActivityNodePort } from "../js/core/ActivityNodeRegistry.js";

for (const type of ["prerequisite", "activityExpiry"]) {
  const definition = getActivityNodeDefinition(type);
  if (definition.flowInputs?.length || definition.flowOutputs?.length || definition.valueOutputs?.length) {
    throw new Error(`${type} unexpectedly exposes an output/input flow port`);
  }
  if (getActivityNodePort(type, "value", "output") || getActivityNodePort(type, "flowOut", "output")) {
    throw new Error(`${type} unexpectedly exposes an output port`);
  }
}

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    end: { id: "end", type: "activityEnd", inputs: {}, outputs: {} },
    expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: false, expiresAt: 0 }, outputs: {} },
    publicVariable: { id: "publicVariable", type: "getGlobal", inputs: { variableId: 100 }, outputs: {} },
    gate: { id: "gate", type: "prerequisite", inputs: {}, outputs: {} },
  },
  connections: [
    { fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    { fromNodeId: "publicVariable", fromPort: "value", toNodeId: "gate", toPort: "condition" },
  ],
};
const checked = validateBlueprint(blueprint);
if (!checked.ok) throw new Error(checked.errors.join("; "));
const result = (value) => new ActivityValueEvaluator(checked.blueprint, {
  globalVariableManager: { get: () => value },
}).readInput("gate", "condition", false) === true;
if (result(true) !== true || result(false) !== false || result(1) !== false) {
  throw new Error("prerequisite gate result is not strict boolean");
}
const duplicate = structuredClone(blueprint);
duplicate.nodes.gate2 = { id: "gate2", type: "prerequisite", inputs: { condition: false }, outputs: {} };
if (validateBlueprint(duplicate).ok) throw new Error("duplicate prerequisite node was accepted");
const legacy = embedLegacyPrerequisite(blueprint, { nodes: {
  read: { id: "read", type: "getGlobal", inputs: { variableId: 100 }, outputs: {} },
  return: { id: "return", type: "returnValue", inputs: {}, outputs: {} },
}, connections: [{ fromNodeId: "read", fromPort: "value", toNodeId: "return", toPort: "condition" }] });
if (!Object.values(legacy.nodes).some((node) => node.type === "prerequisite")) throw new Error("legacy embedding failed");
console.log("social prerequisite probe: ok");
