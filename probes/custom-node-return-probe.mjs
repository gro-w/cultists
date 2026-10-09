import assert from "node:assert/strict";
import { getActivityNodeDefinition, registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import { createActivityInstance } from "../core/ActivityInstance.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { parseCl2 } from "../core/Cl2Parser.js";
import { serializeCl2 } from "../core/Cl2Serializer.js";

registerCustomActivityNode({
  id: "probe:returnPort",
  label: "Probe Return Port",
  flowInputs: [{ name: "flowIn", kind: "flow" }],
  flowOutputs: [{ name: "left", kind: "flow" }, { name: "right", kind: "flow" }],
  valueInputs: [{ name: "condition", kind: "value", type: "bool" }],
  valueOutputs: [],
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "choose", port: "flowIn" } } },
      choose: { id: "choose", type: "branch", inputs: { condition: { parameter: "condition" } }, next: { true: { nodeId: "left", port: "flowIn" }, false: { nodeId: "right", port: "flowIn" } } },
      left: { id: "left", type: "activityEnd", inputs: { port: 1 }, next: {} },
      right: { id: "right", type: "activityEnd", inputs: { port: "default" }, next: {} },
    },
  },
});
const flowRoundTrip = parseCl2(serializeCl2(getActivityNodeDefinition("probe:returnPort").blueprint), {
  validate: true,
  blueprintKind: "customFlow",
});
assert.equal(flowRoundTrip.ok, true, flowRoundTrip.diagnostics.map(({ message }) => message).join("; "));
assert.equal(flowRoundTrip.graph.nodes.left.inputs.port, "1");
assert.equal(flowRoundTrip.graph.nodes.right.inputs.port, "default");

function run(condition) {
  const eventBus = new EventBus();
  const variables = new VariableStore(eventBus);
  const definition = {
    id: "probe",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "macro", port: "flowIn" } } },
        macro: { id: "macro", type: "probe:returnPort", inputs: { condition }, next: { left: { nodeId: "left", port: "flowIn" }, right: { nodeId: "right", port: "flowIn" } } },
        left: { id: "left", type: "setVariable", inputs: { key: "result", value: "left" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
        right: { id: "right", type: "setVariable", inputs: { key: "result", value: "right" }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
        end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
      },
    },
  };
  const checked = validateBlueprint(definition.blueprint);
  assert.equal(checked.ok, true, checked.errors?.join("；"));
  const instance = createActivityInstance("probe");
  createActivityRunner({ definition, instance, variableStore: variables, eventBus }).start();
  return { status: instance.status, result: variables.get("result") };
}

assert.deepEqual(run(true), { status: "resolved", result: "left" });
assert.deepEqual(run(false), { status: "resolved", result: "right" });

registerCustomActivityNode({
  id: "probe:mappedValue",
  label: "Probe Mapped Value",
  flowInputs: [],
  flowOutputs: [],
  valueInputs: [{ name: "amount", kind: "value", type: "number" }],
  valueOutputs: [{ name: "result", kind: "value", type: "number", receiverId: "result" }],
  blueprint: {
    nodes: {
      sum: { id: "sum", type: "arithmetic", inputs: { operator: "+", left: { parameter: "amount" }, right: 2 }, next: {} },
      result: { id: "result", type: "valueReceiver", inputs: { value: { nodeId: "sum", port: "value" } }, next: {} },
    },
  },
});

const valueInstance = createActivityInstance("probe-value");
const valueDefinition = {
  id: "probe-value",
  blueprint: {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, next: { flowOut: { nodeId: "store", port: "flowIn" } } },
      mapped: { id: "mapped", type: "probe:mappedValue", inputs: { amount: 5 }, next: {} },
      store: { id: "store", type: "setVariable", inputs: { key: "mapped-result", value: { nodeId: "mapped", port: "result" } }, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", inputs: {}, next: {} },
    },
  },
};
const valueEventBus = new EventBus();
const valueStore = new VariableStore(valueEventBus);
createActivityRunner({ definition: valueDefinition, instance: valueInstance, variableStore: valueStore, eventBus: valueEventBus }).start();
assert.equal(valueInstance.status, "resolved");
assert.equal(valueStore.get("mapped-result"), 7, "custom value outputs resolve through their 1:1 value receiver mapping");
console.log("custom-node-return-probe: all scenarios passed");
