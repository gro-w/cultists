/* eslint-env node */
/**
 * Build a player-only distribution by removing every DEV-TOOLS block.
 * Usage: node publish.js
 */
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "publish");
const START = /^(\s*)(?:\/\/|\/\*|<!--)\s*DEV-TOOLS:START.*$/;
const END = /^(\s*)(?:\/\/|\/\*|<!--)\s*DEV-TOOLS:END.*$/;
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);

function stripDeveloperBlocks(text, fileName) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let inside = false;
  for (const line of lines) {
    if (START.test(line)) {
      if (inside) throw new Error(`Nested DEV-TOOLS block in ${fileName}`);
      inside = true;
      continue;
    }
    if (END.test(line)) {
      if (!inside) throw new Error(`Unmatched DEV-TOOLS end in ${fileName}`);
      inside = false;
      continue;
    }
    if (!inside) result.push(line);
  }
  if (inside) throw new Error(`Unclosed DEV-TOOLS block in ${fileName}`);
  return result.join("\n");
}

function copyTree(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    // Documentation and agent instructions are not player assets and may
    // intentionally mention development-only tools or markers.
    if ([".git", "publish", "publish.js", "dev-server.js", "editors", "node_modules", ".hermes", "AGENTS.md", "README.md", "docs"].includes(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      fs.copyFileSync(from, to);
      continue;
    }
    const content = stripDeveloperBlocks(fs.readFileSync(from, "utf8"), path.relative(root, from));
    // A file containing only a DEV-TOOLS block is not part of the player build.
    if (content.trim()) {
      fs.writeFileSync(to, content);
    }
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
copyTree(root, output);
console.log(`Published player build to ${path.relative(root, output)}`);
