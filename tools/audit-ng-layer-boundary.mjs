#!/usr/bin/env node
/**
 * Verify the NG directory/layer contract without loading game code.
 * This file is a development tool and is not part of the NG runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ngRoot = path.join(repoRoot, "ng");
const failures = [];
const exists = (relative) => fs.existsSync(path.join(ngRoot, relative));
const fail = (message) => failures.push(message);

for (const required of ["core/engine.js", "style.css", "core", "dev", "data/framework-manifest.json"]) {
  if (!exists(required)) fail(`missing core path: ${required}`);
}
for (const forbidden of ["desktop", "content"]) {
  if (exists(forbidden)) fail(`unclassified runtime path remains at ng/${forbidden}`);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const dataFiles = walk(path.join(ngRoot, "data"));
const frameworkFiles = dataFiles.filter((file) => file.endsWith(".framework.json"));
const gameNativeModules = walk(path.join(ngRoot, "game")).filter((file) => file.endsWith(".js"));
const retiredCoreModules = [
  "FrameworkRuntime.js",
  "KeywordRuntime.js",
  "DialogueWidget.js",
  "PhaseBoundaryService.js",
  "MediaStateManager.js",
  "SelectionSubmissionManager.js",
].filter((name) => exists(`core/${name}`));
for (const name of retiredCoreModules) fail(`framework/game semantic module remains in core: ${name}`);
const invalidFrameworkNames = frameworkFiles.filter((file) => !path.basename(file).endsWith(".framework.json"));
if (invalidFrameworkNames.length) fail(`invalid framework filename: ${invalidFrameworkNames.join(", ")}`);
if (!exists("data/game-manifest.json")) fail("missing data/game-manifest.json");

const engine = walk(path.join(ngRoot, "core"))
  .filter((file) => /^engine(?:-[^/\\]+)?\.js$/.test(path.basename(file)))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
for (const forbiddenImport of ["./probes/", "./tools/", "./scripts/", "./dev-server.js"]) {
  if (engine.includes(forbiddenImport)) fail(`engine imports development tooling: ${forbiddenImport}`);
}

if (process.argv.includes("--strict") && gameNativeModules.length) {
  for (const file of gameNativeModules) fail(`native JavaScript remains in game layer: ${path.relative(ngRoot, file)}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `BOUNDARY_ERROR ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    core: ["../index.html", "core/engine.js", "style.css", "core/", "dev/"],
    frameworkJson: frameworkFiles.map((file) => path.relative(ngRoot, file).replaceAll(path.sep, "/")),
    gameJsonCount: dataFiles.filter((file) => file.endsWith(".json") && !file.endsWith(".framework.json") && path.basename(file) !== "framework-manifest.json").length,
    gameNativeModules: gameNativeModules.map((file) => path.relative(ngRoot, file).replaceAll(path.sep, "/")),
    strictNglGameLayer: gameNativeModules.length === 0,
    excludedTools: ["probes/", "tools/", "dev-server.js"],
  }, null, 2));
}
