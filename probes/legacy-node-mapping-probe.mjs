import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCl2 } from "../core/Cl2Parser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapping = JSON.parse(fs.readFileSync(path.join(root, "tools/migration/legacy-node-mappings.json"), "utf8"));
const activitiesDir = path.join(root, "data", "activities");
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
for (const file of fs.readdirSync(activitiesDir).filter((name) => name.endsWith(".CL2.txt"))) {
  const source = fs.readFileSync(path.join(activitiesDir, file), "utf8");
  const parsed = parseCl2(source, { sourcePath: file, validate: false });
  if (!parsed.ok) throw new Error(`${file}: invalid CL2: ${parsed.diagnostics.map((item) => item.message).join("；")}`);
  walk(parsed.graph);
}
const retiredTypes = Object.entries(mapping.mappings)
  .filter(([, value]) => value.status === "converted")
  .map(([type]) => type);
const residual = retiredTypes.filter((type) => nodeTypes.has(type)).sort();
if (residual.length) throw new Error(`retired legacy node types remain in canonical Activities: ${residual.join(", ")}`);
if (!nodeTypes.size) throw new Error("canonical Activity corpus is empty");
console.log(`legacy-node-mapping-probe: ${nodeTypes.size} canonical node types checked; no retired legacy nodes`);
