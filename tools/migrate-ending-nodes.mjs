#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("data");
let changed = 0;
function visit(value) {
  if (Array.isArray(value)) { value.forEach(visit); return; }
  if (!value || typeof value !== "object") return;
  if (value.type === "ending" && value.inputs && !value.blueprint) {
    const inputs = value.inputs;
    value.type = "emitEvent";
    value.inputs = {
      eventName: "activity:ending",
      payload: {
        endingId: inputs.endingId ?? null,
        displayTo: inputs.displayTo ?? "default",
      },
    };
    changed += 1;
    return;
  }
  Object.values(value).forEach(visit);
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".json")) {
      const source = fs.readFileSync(file, "utf8");
      const value = JSON.parse(source);
      const before = changed;
      visit(value);
      if (changed !== before) fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
  }
}
walk(root);
console.log(`MIGRATED_ENDING_NODES ${changed}`);
