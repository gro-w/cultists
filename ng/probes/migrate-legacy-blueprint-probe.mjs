// Phase 8 content-migration tooling probe: proves
// `ng/tools/migrate-legacy-blueprint.mjs`'s `convertBlueprint()` actually
// produces valid, loadable ng blueprints — not just "no blocked node types
// reported" — for a representative sample plus the real legacy corpus
// files it currently fully covers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertBlueprint } from "../tools/migrate-legacy-blueprint.mjs";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { createActivityRunner } from "../core/ActivityRunner.js";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const legacyDir = path.join(__dirname, "../../data/zh-hans");

function* findBlueprints(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) yield* findBlueprints(item); return; }
  if (typeof value.startNodeId === "string" && value.nodes && typeof value.nodes === "object") { yield value; return; }
  for (const child of Object.values(value)) yield* findBlueprints(child);
}

// --- unsupported node type is reported, not silently dropped ---------------
{
  const legacy = {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      roll: { id: "roll", type: "diceCheck", inputs: { n: 50 } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
  };
  const { ok, blockedTypes } = convertBlueprint(legacy);
  assert.equal(ok, false);
  assert.deepEqual(blockedTypes, ["diceCheck"]);
}

// --- setGlobal/getGlobal field renaming (variableId -> id) ------------------
{
  const legacy = {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      bump: { id: "bump", type: "setGlobal", inputs: { variableId: 40, delta: 5 } },
      end: { id: "end", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "bump", toPort: "flowIn" },
      { fromNodeId: "bump", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ],
  };
  const { ok, blueprint } = convertBlueprint(legacy);
  assert.equal(ok, true);
  assert.equal(blueprint.nodes.bump.type, "applyPublicVariableEffect");
  assert.deepEqual(blueprint.nodes.bump.inputs, { id: 40, delta: 5 });
  const { ok: validOk, errors } = validateBlueprint(blueprint);
  assert.equal(validOk, true, errors.join(", "));
}

// --- text/choice: synthesized keys are stable and end-to-end runnable ------
{
  const legacy = {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", inputs: {} },
      line: { id: "line", type: "text", inputs: { displayTo: "his-app", speaker: "林若晴", text: "你好" } },
      pick: {
        id: "pick", type: "choice", inputs: { branchCount: 2 },
        options: [{ label: "A", next: "a" }, { label: "B", next: "b" }],
      },
      a: { id: "a", type: "activityEnd", inputs: {} },
      b: { id: "b", type: "activityEnd", inputs: {} },
    },
    connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "line", toPort: "flowIn" },
      { fromNodeId: "line", fromPort: "flowOut", toNodeId: "pick", toPort: "flowIn" },
      { fromNodeId: "pick", fromPort: "option0", toNodeId: "a", toPort: "flowIn" },
      { fromNodeId: "pick", fromPort: "option1", toNodeId: "b", toPort: "flowIn" },
    ],
  };
  const first = convertBlueprint(legacy);
  const second = convertBlueprint(legacy);
  assert.equal(first.blueprint.nodes.line.inputs.continueKey, second.blueprint.nodes.line.inputs.continueKey, "same node id must synthesize the same key across runs");
  assert.equal(first.blueprint.nodes.pick.inputs.optionCount, 2);

  const { ok, errors, blueprint: normalized } = validateBlueprint(first.blueprint);
  assert.equal(ok, true, errors.join(", "));

  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const instance = { status: "unresolved", currentNodeId: null, executedNodeIds: [] };
  const runner = createActivityRunner({
    definition: { id: "sample", blueprint: normalized },
    instance,
    variableStore,
    eventBus,
  });
  runner.start();
  assert.equal(instance.waitingNodeId, "line");
  variableStore.set(first.blueprint.nodes.line.inputs.continueKey, true);
  assert.equal(instance.waitingNodeId, "pick");
  variableStore.set(first.blueprint.nodes.pick.inputs.selectionKey, 1);
  assert.equal(instance.status, "resolved");
  assert.equal(instance.waitingNodeId, null);
}

// --- full legacy corpus files this script currently fully covers ----------
{
  const fullyCoveredFiles = [
    "work01a.json", "work02a.json", "work03a.json", "work04a.json",
    "work06a.json", "work07a.json", "work07b.json",
    "social02a.json", "social04a.json", "social05a.json", "social05b.json", "social06a.json",
  ];
  let total = 0;
  for (const file of fullyCoveredFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(legacyDir, file), "utf8"));
    for (const legacyBlueprint of findBlueprints(data)) {
      total += 1;
      const { ok, blueprint, blockedTypes } = convertBlueprint(legacyBlueprint);
      assert.equal(ok, true, `${file}: unexpected blocked types ${blockedTypes}`);
      const { ok: validOk, errors } = validateBlueprint(blueprint);
      assert.equal(validOk, true, `${file}: ${errors.join(", ")}`);
    }
  }
  assert.ok(total >= 68, `expected at least 68 blueprints across the fully-covered files, saw ${total}`);
}

console.log("migrate-legacy-blueprint-probe: all scenarios passed");
