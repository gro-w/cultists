// Proves the generic `getProperty` value node (Phase 8 HIS/ChatGTP window
// work): reads one field off an object value - e.g. a `getRecord`/
// `findRecords` result already stored in variableStore - so a window's
// `valueGraph` can feed a widget's `text`/`options` property with e.g. a
// selected patient's `name` without any domain-specific node type.
import assert from "node:assert/strict";
import { VariableStore } from "../core/VariableStore.js";
import EventBus from "../core/EventBus.js";
import { evaluateValueOutput } from "../core/ActivityRunner.js";

const eventBus = new EventBus();
const variableStore = new VariableStore(eventBus);
variableStore.set("selectedPatient", { id: "p1", name: "林若晴", age: 24 });
variableStore.set("nothing", null);

const blueprint = {
  nodes: {
    patient: { id: "patient", type: "getVariable", inputs: { key: "selectedPatient" } },
    name: { id: "name", type: "getProperty", inputs: { value: { nodeId: "patient", port: "value" }, key: "name" } },
    missing: { id: "missing", type: "getProperty", inputs: { value: { variable: "nothing" }, key: "name" } },
  },
};

// --- reads a nested field off a chained value node ---------------------
{
  const value = evaluateValueOutput(blueprint, "name", "value", variableStore, new Set());
  assert.equal(value, "林若晴");
}

// --- null/undefined target reads back undefined, never throws -----------
{
  const value = evaluateValueOutput(blueprint, "missing", "value", variableStore, new Set());
  assert.equal(value, undefined);
}

// --- direct literal object + missing key ---------------------------------
{
  const directBlueprint = {
    nodes: { age: { id: "age", type: "getProperty", inputs: { value: { variable: "selectedPatient" }, key: "age" } } },
  };
  const value = evaluateValueOutput(directBlueprint, "age", "value", variableStore, new Set());
  assert.equal(value, 24);
}

console.log("get-property-node-probe: ok");
