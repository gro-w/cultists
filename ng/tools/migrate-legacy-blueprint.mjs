#!/usr/bin/env node
/**
 * migrate-legacy-blueprint.mjs — Phase 8 legacy content migration tooling.
 *
 * Per the explicit user instruction ("use scripts to rewrite data into new
 * format when migrating, no need to do everything manually"), this is the
 * one place that knows how to turn a *legacy* Activity blueprint (the
 * `data/zh-hans/*.json` node-graph shape: `{startNodeId, nodes, connections}`
 * with old-engine node `type`s from `js/core/ActivityRunner.js`) into an
 * `ng`-compatible blueprint (same `{startNodeId, nodes, connections}` shape,
 * but with node `type`/`inputs` renamed to `ng/core/ActivityNodeRegistry.js`
 * equivalents). The flat `connections` array itself needs NO transform —
 * `ng/core/ActivityValidator.js#normalizeBlueprint()` already folds that
 * legacy shape into the engine's internal `next`/`inputs` link format at
 * load time, so this script only ever renames node types/fields.
 *
 * Two entry points:
 *   - `convertBlueprint(legacyBlueprint, { synthesizeKey })` — converts one
 *     blueprint, returning `{ ok, blueprint, blockedTypes }`. `blockedTypes`
 *     lists any legacy node type this script does not yet know how to
 *     convert (script fails loudly rather than silently dropping content —
 *     `ok` is false and the original blueprint is returned unchanged).
 *   - CLI `node ng/tools/migrate-legacy-blueprint.mjs --report [dir]` —
 *     walks every JSON file under `dir` (default `data/zh-hans`), finds every
 *     embedded blueprint (any object with `startNodeId` + `nodes`), and
 *     prints a per-file conversion coverage report, without writing
 *     anything out. Use this to decide what to convert-and-commit next.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Node types this script can convert today, and how. Each entry is either:
 *   - a plain string: the legacy type maps 1:1 onto that ng type, with no
 *     input renaming.
 *   - a function `(legacyNode) => ({ type, inputs })`: full control, used
 *     when field names differ (e.g. legacy `variableId` -> ng `id`) or ng
 *     needs an extra synthesized field (e.g. `text`/`choice`'s wait keys).
 */
function makeConverters(synthesizeKey) {
  return {
    flowStart: "flowStart",
    activityEnd: "activityEnd",
    consumeTime: "consumeTime",
    branch: "branch",
    arithmetic: "arithmetic",
    prerequisite: "prerequisite",
    activityExpiry: "activityExpiry",
    // Legacy `{variableId, value|delta}` -> ng `applyPublicVariableEffect`'s
    // `{id, value|delta|toggle|setObjectRef}`. Public-variable ids are
    // unchanged by the Phase 8 slice-1 migration, so `variableId` carries
    // over verbatim as `id`.
    setGlobal: (node) => ({
      type: "applyPublicVariableEffect",
      inputs: { ...node.inputs, id: node.inputs?.variableId, variableId: undefined },
    }),
    getGlobal: (node) => ({
      type: "getPublicVariable",
      inputs: { ...node.inputs, id: node.inputs?.variableId, variableId: undefined },
    }),
    // Legacy `text`/`choice` map onto ng's node types of the same name
    // almost verbatim; ng additionally supports (and, for parity with the
    // legacy "wait for a continue click" behavior, needs) an explicit
    // `continueKey`/`selectionKey` the future dialogue window UI sets via a
    // widget onClick blueprint. Synthesized deterministically from the
    // node id so repeated conversions of the same source are stable.
    text: (node) => ({
      type: "text",
      inputs: { ...node.inputs, continueKey: synthesizeKey(node.id, "continue") },
    }),
    choice: (node) => ({
      type: "choice",
      inputs: {
        options: node.options || node.inputs?.options || [],
        optionCount: Number(node.inputs?.branchCount) || (node.options || []).length,
        selectionKey: synthesizeKey(node.id, "select"),
      },
    }),
  };
}

function defaultSynthesizeKey(nodeId, suffix) {
  return `dlg:${nodeId}:${suffix}`;
}

/**
 * Convert one legacy blueprint. Returns `{ ok, blueprint, blockedTypes }`;
 * on failure (`ok:false`) `blueprint` is the untouched input — callers must
 * not partially write out a blueprint this script cannot fully convert.
 */
export function convertBlueprint(legacyBlueprint, { synthesizeKey = defaultSynthesizeKey } = {}) {
  const converters = makeConverters(synthesizeKey);
  const legacyNodes = legacyBlueprint?.nodes || {};
  const blockedTypes = new Set();
  const nodes = {};

  for (const [id, node] of Object.entries(legacyNodes)) {
    const converter = converters[node.type];
    if (!converter) { blockedTypes.add(node.type); continue; }
    const { type, inputs } = typeof converter === "string" ? { type: converter, inputs: node.inputs } : converter(node);
    const cleanInputs = Object.fromEntries(Object.entries(inputs || {}).filter(([, value]) => value !== undefined));
    nodes[id] = { id, type, inputs: cleanInputs, x: node.x, y: node.y };
  }

  if (blockedTypes.size > 0) {
    return { ok: false, blueprint: legacyBlueprint, blockedTypes: [...blockedTypes] };
  }

  // `connections` needs no shape change (see file-level doc comment); only
  // rewritten if it referenced a `choice` node's dynamic `optionN` ports,
  // which are identical in both schemas, so it is carried over verbatim.
  return {
    ok: true,
    blueprint: { startNodeId: legacyBlueprint.startNodeId, nodes, connections: legacyBlueprint.connections || [] },
    blockedTypes: [],
  };
}

/** Recursively find every `{startNodeId, nodes}`-shaped object in `value`, yielding `[jsonPath, blueprint]`. */
function* findBlueprints(value, jsonPath = "$") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* findBlueprints(value[i], `${jsonPath}[${i}]`);
    return;
  }
  if (typeof value.startNodeId === "string" && value.nodes && typeof value.nodes === "object") {
    yield [jsonPath, value];
    return; // a blueprint's own nodes are never themselves nested blueprints
  }
  for (const [key, child] of Object.entries(value)) yield* findBlueprints(child, `${jsonPath}.${key}`);
}

function runReport(targetDir) {
  const files = fs.readdirSync(targetDir).filter((name) => name.endsWith(".json")).sort();
  let totalBlueprints = 0;
  let convertibleBlueprints = 0;
  const blockedTypeCounts = new Map();

  for (const file of files) {
    const fullPath = path.join(targetDir, file);
    let data;
    try { data = JSON.parse(fs.readFileSync(fullPath, "utf8")); } catch { continue; }
    const results = [...findBlueprints(data)].map(([jsonPath, blueprint]) => ({ jsonPath, ...convertBlueprint(blueprint) }));
    if (results.length === 0) continue;
    totalBlueprints += results.length;
    const ok = results.filter((r) => r.ok).length;
    convertibleBlueprints += ok;
    const blocked = new Set(results.flatMap((r) => r.blockedTypes));
    blocked.forEach((type) => blockedTypeCounts.set(type, (blockedTypeCounts.get(type) || 0) + 1));
    const status = blocked.size === 0 ? "OK" : `BLOCKED(${[...blocked].join(",")})`;
    console.log(`${file}: ${ok}/${results.length} blueprints convertible — ${status}`);
  }

  console.log("\n--- summary ---");
  console.log(`${convertibleBlueprints}/${totalBlueprints} blueprints fully convertible today`);
  console.log("blocking node types, by number of files they appear in:");
  [...blockedTypeCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([type, count]) => console.log(`  ${type}: ${count}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "--report") {
    const targetDir = path.resolve(args[1] || path.join(__dirname, "../../data/zh-hans"));
    runReport(targetDir);
  } else {
    console.log("Usage: node ng/tools/migrate-legacy-blueprint.mjs --report [dir]");
    process.exit(1);
  }
}
