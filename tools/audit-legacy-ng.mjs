#!/usr/bin/env node
/**
 * Full legacy -> ng migration inventory.
 *
 * This is intentionally a report-only tool. It never rewrites authored data:
 * unsupported legacy semantics must be visible before a migration writes them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const legacyDir = path.join(root, "legacy", "data", "zh-hans");
const ngDir = path.join(root, "data");

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return { __parseError: error.message }; }
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function collectBlueprints(value, jsonPath = "$") {
  const found = [];
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((child, index) => found.push(...collectBlueprints(child, `${jsonPath}[${index}]`)));
    return found;
  }
  if (typeof value.startNodeId === "string" && value.nodes && typeof value.nodes === "object") {
    const nodeTypes = {};
    for (const node of Object.values(value.nodes)) {
      const type = node?.type || "<missing>";
      nodeTypes[type] = (nodeTypes[type] || 0) + 1;
    }
    found.push({ path: jsonPath, nodes: Object.keys(value.nodes).length, connections: Array.isArray(value.connections) ? value.connections.length : 0, nodeTypes });
    return found;
  }
  for (const [key, child] of Object.entries(value)) found.push(...collectBlueprints(child, `${jsonPath}.${key}`));
  return found;
}

function summarizeTree(dir) {
  const files = walk(dir).filter((file) => {
    if (!file.endsWith(".json")) return false;
    if (dir !== ngDir) return true;
    const relative = path.relative(dir, file).replaceAll(path.sep, "/");
    // The preserved source package proves authored-data retention, but it is
    // not canonical runtime content and must not inflate parity counts.
    return !relative.startsWith("game-content/legacy/") && relative !== "game-content/legacy-content-index.json";
  });
  const rows = [];
  const nodeTypes = {};
  const ids = new Set();
  for (const file of files) {
    const relative = path.relative(dir, file).replaceAll(path.sep, "/");
    const data = readJson(file);
    const blueprints = data.__parseError ? [] : collectBlueprints(data);
    for (const blueprint of blueprints) {
      for (const [type, count] of Object.entries(blueprint.nodeTypes)) nodeTypes[type] = (nodeTypes[type] || 0) + count;
    }
    if (!data.__parseError) {
      const candidates = [];
      if (Array.isArray(data)) candidates.push(...data);
      else if (data && typeof data === "object") {
        for (const value of Object.values(data)) if (Array.isArray(value)) candidates.push(...value);
      }
      for (const item of candidates) if (item && typeof item === "object" && item.id != null) ids.add(String(item.id));
    }
    rows.push({ file: relative, bytes: fs.statSync(file).size, top: Array.isArray(data) ? "array" : typeof data, count: countValue(data), blueprints: blueprints.length, parseError: data.__parseError || null });
  }
  return { files: rows, nodeTypes, ids: [...ids].sort() };
}

function sourceMatches(globDir, pattern) {
  const matches = [];
  for (const file of walk(globDir).filter((f) => /\.(m?js|html|css)$/.test(f))) {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (relative.startsWith("probes/") || relative.startsWith("tools/") || relative === "dev-server.js") continue;
    const text = fs.readFileSync(file, "utf8");
    if (pattern.test(text)) matches.push(relative);
  }
  return matches;
}

function markdown(report) {
  const legacyFiles = new Set(report.legacy.files.map((row) => row.file));
  const ngFiles = new Set(report.ng.files.map((row) => row.file));
  const missingByName = [...legacyFiles].filter((file) => !ngFiles.has(file));
  const ngIdSet = new Set(report.ng.ids);
  const legacyIdSet = new Set(report.legacy.ids);
  const legacyOnlyIds = report.legacy.ids.filter((id) => !ngIdSet.has(id));
  const ngOnlyIds = report.ng.ids.filter((id) => !legacyIdSet.has(id));
  const sample = (values) => values.length > 50 ? [...values.slice(0, 25), "…", ...values.slice(-25)] : values;
  const lines = [
    "# Legacy → ng migration inventory",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This report is evidence for migration planning. It does not claim runtime parity.",
    "",
    "## Corpus summary",
    "",
    `- Legacy JSON files: **${report.legacy.files.length}**` ,
    `- ng JSON files: **${report.ng.files.length}**`,
    `- Legacy blueprints: **${report.legacy.files.reduce((n, row) => n + row.blueprints, 0)}**`,
    `- ng blueprints: **${report.ng.files.reduce((n, row) => n + row.blueprints, 0)}**`,
    `- Legacy top-level IDs: **${report.legacy.ids.length}**`,
    `- ng top-level IDs: **${report.ng.ids.length}**`,
    "",
    "## Legacy JSON files without same relative filename in ng",
    "",
    missingByName.length ? missingByName.map((file) => `- \`${file}\``).join("\n") : "- None",
    "",
    "## Node-type inventory",
    "",
    "| Node type | Legacy occurrences | ng occurrences |",
    "| --- | ---: | ---: |",
  ];
  const types = new Set([...Object.keys(report.legacy.nodeTypes), ...Object.keys(report.ng.nodeTypes)]);
  for (const type of [...types].sort()) lines.push(`| \`${type}\` | ${report.legacy.nodeTypes[type] || 0} | ${report.ng.nodeTypes[type] || 0} |`);
  lines.push("", "## Stable-ID differences", "", "### Legacy IDs absent from ng", "", `- Count: **${legacyOnlyIds.length}**`,
 legacyOnlyIds.length ? sample(legacyOnlyIds).map((id) => `- \`${id}\``).join("\n") : "- None", "", "### ng IDs absent from legacy", "", `- Count: **${ngOnlyIds.length}**`,
 ngOnlyIds.length ? sample(ngOnlyIds).map((id) => `- \`${id}\``).join("\n") : "- None", "", "## Runtime/editor entry-point inventory", "");
  for (const row of report.source) lines.push(`- ${row.label}: ${row.files.length ? row.files.map((file) => `\`${file}\``).join(", ") : "none"}`);
  lines.push("", "## File-level details", "", "| Tree | File | Top-level shape | Count | Blueprints | Bytes |", "| --- | --- | --- | ---: | ---: | ---: |");
  for (const [tree, summary] of [["legacy", report.legacy], ["ng", report.ng]]) for (const row of summary.files) lines.push(`| ${tree} | \`${row.file}\` | ${row.top} | ${row.count} | ${row.blueprints} | ${row.bytes} |`);
  lines.push("");
  return lines.join("\n");
}

const legacy = summarizeTree(legacyDir);
const ng = summarizeTree(ngDir);
const source = [
  { label: "Legacy data loaders", files: sourceMatches(path.join(root, "legacy", "js"), /loadJSON|fetch\(/) },
  { label: "ng data loading", files: sourceMatches(path.join(root, "ng"), /loadManifest|loadRecordSet|fetch\(/) },
  { label: "Legacy developer editors", files: sourceMatches(path.join(root, "legacy", "js"), /Dev[A-Za-z]+Editor|DeveloperMode/) },
  { label: "ng developer tools", files: sourceMatches(path.join(root, "ng"), /DEV-TOOLS|DeveloperMode|EditorView/) },
];
const report = { legacy, ng, source };
const output = process.argv.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : markdown(report);
const outPath = process.argv.includes("--write") ? path.join(root, "ng", "LEGACY-NG-MIGRATION-INVENTORY.md") : null;
if (outPath) fs.writeFileSync(outPath, markdown(report), "utf8");
process.stdout.write(output);
if (outPath) process.stderr.write(`Wrote ${path.relative(process.cwd(), outPath)}\n`);
