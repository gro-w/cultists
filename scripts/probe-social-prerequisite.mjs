import { validatePrerequisiteBlueprint } from "../js/core/ScheduleBlueprint.js";
import { ScheduleValueEvaluator } from "../js/core/ScheduleValueEvaluator.js";

const blueprint = {
  nodes: {
    publicVariable: { id: "publicVariable", type: "getGlobal", inputs: { variableId: 100 }, outputs: {} },
    return: { id: "return", type: "returnValue", inputs: {}, outputs: {} },
  },
  connections: [{ fromNodeId: "publicVariable", fromPort: "value", toNodeId: "return", toPort: "condition" }],
};
const checked = validatePrerequisiteBlueprint(blueprint);
if (!checked.ok) throw new Error(checked.errors.join("; "));
const result = (value) => new ScheduleValueEvaluator(checked.blueprint, {
  globalVariableManager: { get: () => value },
}).evaluateNode("return", "value");
if (result(true) !== true || result(false) !== false || result(1) !== false) {
  throw new Error("prerequisite gate result is not strict boolean");
}
const invalid = validatePrerequisiteBlueprint({ nodes: {
  flow: { id: "flow", type: "flowStart", inputs: {}, outputs: {} },
  return: { id: "return", type: "returnValue", inputs: { condition: true }, outputs: {} },
}, connections: [] });
if (invalid.ok) throw new Error("flow node was accepted in prerequisite blueprint");
console.log("social prerequisite probe: ok");
