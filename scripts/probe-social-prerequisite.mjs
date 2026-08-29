import { validateBlueprint, embedLegacyPrerequisite } from "../js/core/ScheduleBlueprint.js";
import { ScheduleValueEvaluator } from "../js/core/ScheduleValueEvaluator.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    end: { id: "end", type: "scheduleEnd", inputs: {}, outputs: {} },
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
const result = (value) => new ScheduleValueEvaluator(checked.blueprint, {
  globalVariableManager: { get: () => value },
}).evaluateNode("gate", "value");
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
