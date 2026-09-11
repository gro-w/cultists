#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("data");
let changed = 0;
for (const file of fs.readdirSync(root, { recursive: true })) {
  if (!file.endsWith(".json")) continue;
  const filename = path.join(root, file);
  const source = fs.readFileSync(filename, "utf8");
  const next = source.replace(/"type": "consumeTime"/g, '"type": "framework.consumeTime"');
  if (next !== source) {
    fs.writeFileSync(filename, next, "utf8");
    changed += (source.match(/"type": "consumeTime"/g) || []).length;
  }
}
console.log(`MIGRATED_CONSUME_TIME_NODES ${changed}`);
