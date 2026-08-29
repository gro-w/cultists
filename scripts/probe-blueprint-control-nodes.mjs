import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEmptyBlueprint, validateBlueprint } from "../js/core/ScheduleBlueprint.js";

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
    assert.equal(nodes.filter((node) => node.type === "prerequisite").length, 1, `${file}: prerequisite count`);
    assert.equal(nodes.filter((node) => node.type === "scheduleExpiry").length, 1, `${file}: expiry count`);
    const validation = validateBlueprint(value);
    assert.equal(validation.ok, true, `${file}: ${validation.errors.join("; ")}`);
  }
  Object.values(value).forEach((child) => visit(child, file));
}

for (const file of fs.globSync("data/**/*.json")) {
  visit(JSON.parse(fs.readFileSync(file, "utf8")), file);
}
const template = createEmptyBlueprint();
assert.equal(Object.values(template.nodes).filter((node) => node.type === "prerequisite").length, 1);
assert.equal(template.nodes.__prerequisite__.inputs.condition, true);
assert.equal(Object.values(template.nodes).filter((node) => node.type === "scheduleExpiry").length, 1);
assert.equal(template.nodes.__schedule_expiry__.inputs.expires, false);
assert.equal(count, 123, `unexpected blueprint count: ${count}`);
console.log(`blueprint control nodes probe: ok (${count} blueprints)`);
