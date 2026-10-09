import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BlueprintNodeManagerView } from "../dev/BlueprintNodeManagerView.js";
import { registerCustomActivityNode, getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";

const source = JSON.parse(await readFile(new URL("../example.data/blueprint-nodes.json", import.meta.url), "utf8"));
const viewSource = await readFile(new URL("../dev/BlueprintNodeManagerView.js", import.meta.url), "utf8");
const nodes = source;
assert.equal(nodes.length, 4, "the example package contains all four custom flow/value node examples");
const frameworkNodes = JSON.parse(await readFile(new URL("../../data/blueprint-nodes.framework.json", import.meta.url), "utf8"));
nodes.push(...frameworkNodes.filter((node) => node.id === "testValueNode"));
assert.equal(nodes.length, 5, "the example package and game data include flow and mapped-value custom nodes");
for (const node of nodes) registerCustomActivityNode(node);

const opened = [];
const view = Object.create(BlueprintNodeManagerView.prototype);
Object.assign(view, {
  nodes,
  selectedId: null,
  openEditor: (node, onSave) => opened.push({ node, onSave }),
  render: () => {},
});

for (const node of nodes) {
  assert.equal(view.openBlueprintEditor(node.id), true, `${node.id} can be opened from the manager`);
  const editor = opened.at(-1);
  assert.equal(editor.node.id, node.id);
  const updatedBlueprint = structuredClone(node.blueprint);
  const editedNodeId = updatedBlueprint.nodes.start ? "start" : "double";
  updatedBlueprint.nodes[editedNodeId].x += 37;
  editor.onSave(updatedBlueprint);
  assert.equal(node.blueprint.nodes[editedNodeId].x, updatedBlueprint.nodes[editedNodeId].x,
    `${node.id} saves its edited graph back to the manager's node definition`);
  assert.equal(getActivityNodeDefinition(node.id).blueprint.nodes[editedNodeId].x, updatedBlueprint.nodes[editedNodeId].x,
    `${node.id} refreshes the registered runtime definition after save`);
}

assert.match(viewSource, /data-field="kind"/, "the inspector exposes an explicit flow/value type selector");
assert.match(viewSource, /ng-blueprint-node-visual/, "the inspector renders a visual node with visible port sockets");
assert.match(viewSource, /_addPin\(node, key\)/, "pins can be added through the visual inspector");
assert.match(viewSource, /_removePin\(node, key, index\)/, "pins can be removed through the visual inspector");

function makeInspectorHarness(node) {
  const view = Object.create(BlueprintNodeManagerView.prototype);
  let fields = {};
  let groups = {};
  const refresh = (draft = node) => {
    fields = { label: draft.label || draft.id, description: draft.description || "" };
    groups = Object.fromEntries(["flowInputs", "flowOutputs", "valueInputs", "valueOutputs"].map((key) => [
      key,
      (draft[key] || []).map((port) => ({
        name: port.name,
        type: port.type || "any",
      })),
    ]));
  };
  Object.assign(view, {
    nodes: [node],
    selectedId: node.id,
    draft: null,
    detailEl: {
      querySelector(selector) {
        const match = selector.match(/data-field="([^"]+)"/);
        return { value: fields[match?.[1]] || "" };
      },
      querySelectorAll(selector) {
        const key = selector.match(/data-port-group="([^"]+)"/)?.[1];
        return (groups[key] || []).map((port) => ({
          querySelector(fieldSelector) {
            const field = fieldSelector.match(/data-port-field="([^"]+)"/)?.[1];
            return { value: port[field] || "" };
          },
        }));
      },
    },
    render() { refresh(this.draft || node); },
  });
  refresh();
  return view;
}

const flowNode = structuredClone(nodes.find((node) => node.flowInputs.length && !node.valueOutputs.length));
const flowView = makeInspectorHarness(flowNode);
const flowOutputCount = flowNode.flowOutputs.length;
flowView._addPin(flowNode, "flowOutputs");
assert.equal(flowView.draft.flowOutputs.length, flowOutputCount + 1, "flow output pins are variable-count");
assert.equal(flowView._saveNode(flowNode), true, "the added flow output saves through registry validation");
assert.equal(getActivityNodeDefinition(flowNode.id).flowOutputs.length, flowOutputCount + 1);
flowView._removePin(flowNode, "flowOutputs", flowNode.flowOutputs.length - 1);
assert.equal(flowView._saveNode(flowNode), true, "removing a flow output preserves a valid return mapping");
assert.equal(getActivityNodeDefinition(flowNode.id).flowOutputs.length, flowOutputCount);

const valueNode = structuredClone(nodes.find((node) => node.valueOutputs.length));
const valueView = makeInspectorHarness(valueNode);
const valueInputCount = valueNode.valueInputs.length;
valueView._addPin(valueNode, "valueInputs");
assert.equal(valueView.draft.valueInputs.length, valueInputCount + 1, "a value input pin can be added");
assert.equal(valueView._saveNode(valueNode), true, "an added value input saves through registry validation");
valueView._removePin(valueNode, "valueInputs", valueNode.valueInputs.length - 1);
assert.equal(valueView._saveNode(valueNode), true, "an optional value input pin can be removed");
assert.equal(getActivityNodeDefinition(valueNode.id).valueInputs.length, valueInputCount);
valueView._addPin(valueNode, "valueOutputs");
assert.equal(valueView.draft.valueOutputs.length, 2, "a value node can expose a second value output");
assert.equal(Object.keys(valueView.draft.blueprint.nodes).filter((id) => valueView.draft.blueprint.nodes[id].type === "valueReceiver").length, 2,
  "each value output receives an internal system receiver");
assert.equal(valueView._saveNode(valueNode), true, "the added value output saves through registry validation");
valueView._removePin(valueNode, "valueOutputs", 1);
assert.equal(valueView._saveNode(valueNode), true, "removing an extra value output updates its receiver set");
assert.equal(getActivityNodeDefinition(valueNode.id).valueOutputs.length, 1);

console.log("blueprint-node-manager-probe: visual type selector, pin add/remove, variable flow outputs, value receivers, and blueprint edit/save paths passed");
