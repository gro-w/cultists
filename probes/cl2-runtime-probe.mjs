import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decodeCl2Blueprints } from "../core/Cl2Embedded.js";
import { parseCl2 } from "../core/Cl2Parser.js";
import { registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { createActivityRunner } from "../core/ActivityRunner.js";

const read = (file) => fs.readFileSync(file, "utf8");
const customNodes = decodeCl2Blueprints(JSON.parse(read("data/blueprint-nodes.framework.json")), "blueprint-nodes");
customNodes.forEach((node) => registerCustomActivityNode(node));

const manifest = JSON.parse(read("data/activity-manifest.json"));
const loader = { loadText: async (file) => read(path.join("data", file)) };
const store = new ActivityDefinitionStore(loader);
const definitions = await store.loadManifest(manifest.activityIds, "activities/");
assert.equal(definitions.length, manifest.activityIds.length, "every manifest Activity must load through CL2");
assert.ok(definitions.every((definition) => definition.format === "CL2"));
assert.ok(definitions.every((definition) => definition.sourcePath.endsWith(".CL2.txt")));

let embeddedCount = 0;
let multilineCount = 0;
function scan(value, sourcePath) {
  if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${sourcePath}[${index}]`));
  if (!value || typeof value !== "object") return;
  if (typeof value.cl2 === "string") {
    embeddedCount += 1;
    if (/\r|\n/.test(value.cl2)) multilineCount += 1;
    assert.ok(!value.cl2.includes("//"), `${sourcePath} must not use line comments`);
    assert.equal(parseCl2(value.cl2, { sourcePath, validate: false }).ok, true, sourcePath);
    return;
  }
  Object.entries(value).forEach(([key, child]) => scan(child, `${sourcePath}.${key}`));
}
for (const file of [
  ...fs.readdirSync("data/windows").map((name) => path.join("data/windows", name)),
  "data/databases/inventoryItems.json",
  "data/blueprint-nodes.framework.json",
]) scan(JSON.parse(read(file)), file);
assert.ok(embeddedCount > 0);
assert.equal(multilineCount, 0, "embedded CL2 must be one line in JSON");
assert.equal(parseCl2("/* header */start: flowStart();end: end();", { validate: false }).ok, true);
assert.equal(parseCl2("// forbidden\nstart: flowStart();", { validate: false }).ok, false);

const runtimeGraph = parseCl2(
  "start: flowStart() -> set; set: setVariable(\"probe\", 7) -> end; end: activityEnd();",
  { validate: false },
).graph;
const values = new Map();
const instance = { instanceId: "cl2-probe", status: "unresolved", executedNodeIds: [], localVariables: {} };
const runner = createActivityRunner({
  definition: { blueprint: runtimeGraph },
  instance,
  variableStore: { get: (key) => values.get(key), set: (key, value) => values.set(key, value), delta: () => {} },
});
runner.start();
assert.equal(values.get("probe"), 7);
assert.equal(instance.status, "resolved");
assert.equal(instance.resolutionReason, "completed");
console.log(`cl2-runtime-probe: ${definitions.length} activities, ${embeddedCount} embedded blueprints, ok`);
