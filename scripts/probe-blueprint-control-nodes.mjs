import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEmptyBlueprint, validateBlueprint } from "../js/core/ActivityBlueprint.js";

const root = path.resolve("data");
let count = 0;
function visit(value, file) {
  if (Array.isArray(value)) {
    value.forEach((child) => visit(child, file));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.nodes && typeof value.nodes === "object" && (value.startNodeId || Object.values(value.nodes).some((node) => node?.type === "flowStart"))) {
    count += 1;
    const nodes = Object.values(value.nodes);
    const controls = nodes.filter((node) => node.type === "prerequisite" || node.type === "activityExpiry");
    const hasControlPair = controls.length > 0;
    if (hasControlPair) {
      assert.equal(nodes.filter((node) => node.type === "prerequisite").length, 1, `${file}: prerequisite count`);
      assert.equal(nodes.filter((node) => node.type === "activityExpiry").length, 1, `${file}: expiry count`);
    }
    controls.forEach((node) => assert.deepEqual(node.outputs || {}, {}, `${file}: ${node.id} must have no output pins`));
    if (hasControlPair) {
      const validation = validateBlueprint(value);
      assert.equal(validation.ok, true, `${file}: ${validation.errors.join("; ")}`);
    }
  }
  Object.values(value).forEach((child) => visit(child, file));
}

for (const file of fs.globSync("data/**/*.json")) {
  visit(JSON.parse(fs.readFileSync(file, "utf8")), file);
}
const template = createEmptyBlueprint();
assert.equal(Object.values(template.nodes).filter((node) => node.type === "prerequisite").length, 1);
assert.equal(template.nodes.__prerequisite__.inputs.condition, true);
assert.equal(Object.values(template.nodes).filter((node) => node.type === "activityExpiry").length, 1);
assert.equal(template.nodes.__activity_expiry__.inputs.expires, false);
assert.ok(count > 0, "no blueprints were discovered");
console.log(`blueprint control nodes probe: ok (${count} blueprints)`);
