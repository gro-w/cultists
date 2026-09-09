import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isEngineActivityNode, registerCustomActivityNode } from "../core/ActivityNodeRegistry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const definitions = JSON.parse(fs.readFileSync(path.join(here, "../data/blueprint-nodes.framework.json"), "utf8"));
for (const definition of definitions) {
  if (!isEngineActivityNode(definition.id)) registerCustomActivityNode(definition);
}
