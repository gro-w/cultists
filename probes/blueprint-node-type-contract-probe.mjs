import assert from "node:assert/strict";
import {
  classifyActivityNodePorts,
  registerCustomActivityNode,
} from "../core/ActivityNodeRegistry.js";
import { parseCl2 } from "../core/Cl2Parser.js";

const flow = (name) => ({ name, kind: "flow" });
const value = (name) => ({ name, kind: "value" });

const valid = [
  [{ flowInputs: [flow("in")], valueInputs: [value("arg")] }, "flow"],
  [{ flowInputs: [flow("in")], flowOutputs: [flow("out")], valueInputs: [value("arg")] }, "flow"],
  [{ valueInputs: [value("arg")], valueOutputs: [value("result")] }, "value"],
  [{ flowOutputs: [flow("out")], valueInputs: [value("arg")] }, "flowStart"],
  [{ valueInputs: [value("result")] }, "valueReceiver"],
];
for (const [definition, expected] of valid) {
  assert.equal(classifyActivityNodePorts(definition), expected);
}

const invalid = [
  {},
  { flowInputs: [flow("in")], valueOutputs: [value("result")] },
  { flowOutputs: [flow("out")], valueOutputs: [value("result")] },
  { flowInputs: [flow("in")], flowOutputs: [flow("out")], valueOutputs: [value("result")] },
  { flowInputs: [{ name: "in", kind: "value" }] },
  { valueInputs: [flow("in")] },
  { flowInputs: [flow("same")], valueInputs: [value("same")] },
];
for (const definition of invalid) {
  assert.equal(classifyActivityNodePorts(definition), null, JSON.stringify(definition));
}

const activitySource = parseCl2("start: flowStart(); end: end();");
assert.equal(activitySource.ok, true, activitySource.diagnostics.map(({ message }) => message).join("; "));
for (const type of ["prerequisite", "activityExpiry"]) {
  assert.equal(Object.values(activitySource.graph.nodes).filter((node) => node.type === type).length, 1, `Activity parser allocates its fixed ${type} receiver`);
}
const legacyActivityEnd = parseCl2('start: flowStart(); finish: end("player", "");');
assert.equal(legacyActivityEnd.ok, true, legacyActivityEnd.diagnostics.map(({ message }) => message).join("; "));
assert.deepEqual(legacyActivityEnd.graph.nodes.finish.inputs, {}, "ordinary Activity end arguments are not macro return ports");
const pureValueSource = parseCl2("reusablevalue answer: arithmetic[\"+\", 2, 3]; inputvalue labelText: valueReceiver[answer[]];", {
  blueprintKind: "value",
});
assert.equal(pureValueSource.ok, true, pureValueSource.diagnostics.map(({ message }) => message).join("; "));
assert.equal(pureValueSource.graph.nodes.labelText.cl2Class, "valueReceiver");

assert.throws(() => registerCustomActivityNode({
  id: "probe:custom-start",
  flowOutputs: [flow("out")],
}), /flow node or value node/i, "custom definitions cannot claim the system flow-start category");
assert.throws(() => registerCustomActivityNode({
  id: "probe:custom-receiver",
  valueInputs: [value("in")],
}), /flow node or value node/i, "custom definitions cannot claim the system value-receiver category");

registerCustomActivityNode({
  id: "probe:custom-flow",
  flowInputs: [flow("in")],
  flowOutputs: [flow("out")],
  valueInputs: [value("arg")],
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", inputs: { port: "default" }, next: {} },
    },
  },
});
registerCustomActivityNode({
  id: "probe:custom-value",
  valueInputs: [value("arg")],
  valueOutputs: [{ ...value("result"), receiverId: "receiver" }],
  blueprint: {
    nodes: {
      receiver: { id: "receiver", type: "valueReceiver", inputs: { value: 0 }, next: {} },
    },
  },
});

console.log("blueprint-node-type-contract-probe: four node categories passed");
