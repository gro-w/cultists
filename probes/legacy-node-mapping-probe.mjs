import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapping = JSON.parse(fs.readFileSync(path.join(root, "tools/migration/legacy-node-mappings.json"), "utf8"));
const legacyDataRoots = [
  path.join(root, "legacy", "data", "zh-hans"),
  path.join(root, "data", "game-content", "legacy", "zh-hans"),
];
const legacy = JSON.parse(fs.readFileSync(path.join(legacyDataRoots[1], "items.json"), "utf8"));
const legacyFiles = [...new Set(legacyDataRoots.flatMap((dir) => fs.readdirSync(dir).filter((file) => file.endsWith(".json"))))];
const nodeTypes = new Set();
const walk = (value) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach(walk);
  if (typeof value.startNodeId === "string" && value.nodes && typeof value.nodes === "object") {
    for (const node of Object.values(value.nodes)) {
      if (node && typeof node.type === "string") nodeTypes.add(node.type);
    }
    return;
  }
  Object.values(value).forEach(walk);
};
for (const file of legacyFiles) {
  const dataRoot = legacyDataRoots.find((dir) => fs.existsSync(path.join(dir, file)));
  const data = JSON.parse(fs.readFileSync(path.join(dataRoot, file), "utf8"));
  walk(data);
}
const missing = [...nodeTypes].filter((type) => !mapping.mappings[type]).sort();
if (missing.length) throw new Error(`unclassified legacy node types: ${missing.join(", ")}`);
if (!legacy.items || !Array.isArray(legacy.items)) throw new Error("sanity check failed: item content missing");
console.log(`legacy-node-mapping-probe: ${nodeTypes.size} node types classified`);
