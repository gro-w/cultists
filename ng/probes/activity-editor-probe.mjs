import assert from "node:assert/strict";
import { createActivityEditorModel } from "../dev/ActivityEditorModel.js";
import { createActivityListManagerModel } from "../dev/ActivityListManagerModel.js";

const sourceBlueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {} },
    setValue: { id: "setValue", type: "setVariable", x: 200, y: 40, inputs: { key: "counter", value: 1 } },
    end: { id: "end", type: "activityEnd", x: 360, y: 40, inputs: {} },
  },
  connections: [
    { id: "edge-1", fromNodeId: "start", fromPort: "flowOut", toNodeId: "setValue", toPort: "flowIn" },
    { id: "edge-2", fromNodeId: "setValue", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
  ],
};

// --- Scenario 1: two editor windows never share state ------------------------
{
  const editorA = createActivityEditorModel({ activityId: "demo", blueprint: sourceBlueprint });
  const editorB = createActivityEditorModel({ activityId: "demo", blueprint: sourceBlueprint });

  editorA.moveNode("start", 999, 999);
  editorA.selectOnly("start");
  editorA.addNode("consumeTime", 500, 40, { minutes: 5 });

  assert.equal(editorB.getNode("start").x, 40, "editor B's node position must be untouched by editor A's move");
  assert.equal(editorB.getNode("start").y, 40);
  assert.deepEqual(editorB.getSelection(), [], "editor B's selection must be untouched by editor A's selection");
  assert.equal(editorB.listNodes().length, 3, "editor B must not see nodes added in editor A");
  assert.equal(editorA.listNodes().length, 4);

  // Mutating the exported blueprint of one editor must not leak into the other's live state either.
  const exportedA = editorA.exportBlueprint();
  exportedA.nodes.start.x = -1;
  assert.equal(editorA.getNode("start").x, 999, "exportBlueprint() must return a detached copy");
}

// --- Scenario 2: export -> reload round-trip preserves nodes, connections,
// positions and the "presentation target" (each node's x/y) -----------------
{
  const editor = createActivityEditorModel({ activityId: "demo", blueprint: sourceBlueprint });
  editor.moveNode("setValue", 250, 90);
  editor.addNode("branch", 300, 200, { condition: true });

  const exported = editor.exportBlueprint();
  const reloaded = createActivityEditorModel({ activityId: "demo", blueprint: exported });

  assert.deepEqual(reloaded.listNodes().sort((a, b) => a.id.localeCompare(b.id)), exported_sorted(exported.nodes));
  assert.deepEqual(reloaded.listConnections(), exported.connections);
  assert.equal(reloaded.getNode("setValue").x, 250);
  assert.equal(reloaded.getNode("setValue").y, 90);
  assert.equal(reloaded.startNodeId, exported.startNodeId);

  function exported_sorted(nodesById) {
    return Object.values(nodesById).sort((a, b) => a.id.localeCompare(b.id));
  }
}

// --- Scenario 3: a blueprint with an incompatible/unknown port connection
// cannot be saved, and connect() itself refuses to create one ----------------
{
  const editor = createActivityEditorModel({ activityId: "demo", blueprint: sourceBlueprint });

  // connect() must reject wiring into a non-existent / wrong-role port name.
  const badAttempt = editor.connect("start", "flowOut", "setValue", "notAPort");
  assert.equal(badAttempt.ok, false);
  assert.equal(editor.listConnections().length, 2, "a rejected connect() must not mutate the blueprint");

  // Directly loading a blueprint that already contains a bad connection (e.g.
  // produced by hand-editing JSON) must fail validateForSave(), blocking save.
  const brokenBlueprint = {
    ...sourceBlueprint,
    connections: [
      ...sourceBlueprint.connections,
      { id: "edge-bad", fromNodeId: "start", fromPort: "flowOut", toNodeId: "setValue", toPort: "flowOut" },
    ],
  };
  editor.loadBlueprint(brokenBlueprint);
  const result = editor.validateForSave();
  assert.equal(result.ok, false, "a structurally invalid connection must block save");
  assert.ok(result.errors.some((message) => message.includes("引脚") || message.includes("不兼容")));
}

// --- Scenario 4: downloaded JSON content matches the in-memory draft --------
{
  const editor = createActivityEditorModel({ activityId: "demo", blueprint: sourceBlueprint, displayName: "演示流程" });
  editor.moveNode("end", 400, 40);
  const download = editor.toDownloadPayload();
  const parsedDownload = JSON.parse(download);
  assert.deepEqual(parsedDownload, editor.toDefinition(), "download payload must equal the in-memory draft it was generated from");
  assert.deepEqual(parsedDownload.blueprint, editor.exportBlueprint());
}

// --- Activity List Manager: default list pinned + remove-vs-delete distinction
{
  const manager = createActivityListManagerModel();
  manager.registerList({ id: "default", activityIds: ["default"] });
  manager.registerActivity("default", { id: "default", blueprint: sourceBlueprint });
  manager.createList("social");
  manager.duplicateActivity("default", "default", "social-greeting");
  manager.registerList({ id: "social", activityIds: [] });
  manager.registerActivity("social", { id: "social-greeting", blueprint: sourceBlueprint });

  const lists = manager.listLists();
  assert.equal(lists[0].id, "default", "the built-in default list must always sort first");
  assert.throws(() => manager.removeList("default"), /不能删除/);
  assert.throws(() => manager.renameList("default", "renamed"), /不能重命名/);

  // "从列表移除" only unlinks the activity from the list; the definition survives.
  manager.removeFromList("social", "social-greeting");
  assert.equal(manager.listActivities("social").length, 0);
  assert.ok(manager.getActivity("social-greeting"), "removeFromList must not delete the underlying activity definition");

  // "删除文件" actually deletes the activity definition everywhere.
  manager.deleteActivityDefinition("social-greeting");
  assert.equal(manager.getActivity("social-greeting"), null);
}

// --- Scenario 5: value-port connect()/disconnect() through the editor, plus
// autoLayout() producing a valid non-overlapping rank/row assignment --------
{
  const editor = createActivityEditorModel({
    activityId: "value-demo",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", x: 0, y: 0, inputs: {} },
        getVar: { id: "getVar", type: "getVariable", x: 0, y: 0, inputs: { key: "threshold" } },
        math: { id: "math", type: "arithmetic", x: 0, y: 0, inputs: { operator: "+", right: 5, left: 1 } },
        branch: { id: "branch", type: "branch", x: 0, y: 0, inputs: {} },
        endTrue: { id: "endTrue", type: "activityEnd", x: 0, y: 0, inputs: {} },
        endFalse: { id: "endFalse", type: "activityEnd", x: 0, y: 0, inputs: {} },
      },
      connections: [
        { id: "e1", fromNodeId: "start", fromPort: "flowOut", toNodeId: "branch", toPort: "flowIn" },
        { id: "e2", fromNodeId: "branch", fromPort: "true", toNodeId: "endTrue", toPort: "flowIn" },
        { id: "e3", fromNodeId: "branch", fromPort: "false", toNodeId: "endFalse", toPort: "flowIn" },
      ],
    },
  });

  // A value output can wire into a value input, and doing so must clear any
  // stale literal on that input port.
  const wire = editor.connect("getVar", "value", "math", "left");
  assert.equal(wire.ok, true, `value-to-value connect should succeed: ${wire.error}`);
  assert.equal(editor.getNode("math").inputs.left, undefined, "wiring an input must clear its previous literal value");

  // Rewiring the same input target replaces the old connection instead of
  // creating a second edge into the same port.
  const rewire = editor.connect("getVar", "value", "math", "left");
  assert.equal(editor.listConnections().filter((c) => c.toNodeId === "math" && c.toPort === "left").length, 1);
  assert.equal(rewire.ok, true);

  // A flow port cannot connect to a value port and vice versa.
  const mismatched = editor.connect("start", "flowOut", "math", "left");
  assert.equal(mismatched.ok, false, "flow output must not connect to a value input");

  editor.disconnect(editor.listConnections().find((c) => c.toNodeId === "math" && c.toPort === "left").id);
  assert.equal(editor.listConnections().some((c) => c.toNodeId === "math" && c.toPort === "left"), false);

  const changed = editor.autoLayout();
  assert.equal(changed, true);
  const positions = editor.listNodes().map((node) => ({ id: node.id, x: node.x, y: node.y }));
  // start (rank 0) must sit strictly left of branch (rank 1), which must sit
  // strictly left of endTrue/endFalse (rank 2) - the whole point of the
  // layered auto-layout.
  const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
  assert.ok(byId.start.x < byId.branch.x, "flowStart must be laid out left of the nodes it flows into");
  assert.ok(byId.branch.x < byId.endTrue.x && byId.branch.x < byId.endFalse.x, "branch must be laid out left of its two flow targets");
  // The two nodes sharing a rank (endTrue/endFalse) must not overlap vertically.
  assert.notEqual(byId.endTrue.y, byId.endFalse.y, "same-rank nodes must be stacked in distinct rows");
}

console.log("activity-editor-probe: all scenarios passed");
