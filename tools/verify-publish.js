/* eslint-env node */
/**
 * Build and verify the player distribution, then always remove publish/.
 * Usage: node tools/verify-publish.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "publish");
const textExtensions = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);
const forbidden = [
  "DEV-TOOLS",
  "DeveloperMode",
  "dev-server.js",
  "data/game-content",
  "legacy-content-index",
  "game-content/legacy",
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function verifyTree() {
  const violations = [];
  for (const file of walk(output)) {
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const marker of forbidden) {
      if (content.includes(marker)) violations.push(`${path.relative(root, file)}: ${marker}`);
    }
  }
  if (violations.length) throw new Error(`forbidden player-build content:\n${violations.join("\n")}`);
  run(process.execPath, ["--check", path.join(output, "core", "engine.js")]);
}

let failed = false;
try {
  run(process.execPath, [path.join("tools", "publish.js")]);
  verifyTree();
  console.log("publish verification passed; publish/ will be removed");
} catch (error) {
  failed = true;
  console.error(error.message);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
  console.log("Removed publish/");
}
if (failed) process.exitCode = 1;
