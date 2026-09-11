import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceData = path.join(root, "legacy", "data");
const targetRoot = path.join(root, "data", "game-content", "legacy");
const targetAssets = path.join(root, "data", "assets");
const dataFilesPath = path.join(root, "data", "data-files.json");
const indexPath = path.join(root, "data", "game-content", "legacy-content-index.json");
const sourceRootFiles = ["languages.json", "strings.zh_hans.json"];
const sourceRootFileSet = new Set(sourceRootFiles);

const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true });
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
};
const normalizeJson = (value) => {
  if (typeof value === "string") {
    return value.replaceAll("data/assets/", "assets/");
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeJson(item)]));
  }
  return value;
};

fs.rmSync(targetRoot, { recursive: true, force: true });
mkdir(targetRoot);
mkdir(targetAssets);
const records = [];
const copyJson = (source) => {
  const relative = path.relative(sourceData, source).replaceAll(path.sep, "/");
  const destination = path.join(targetRoot, relative);
  mkdir(path.dirname(destination));
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  const output = `${JSON.stringify(normalizeJson(parsed), null, 2)}\n`;
  fs.writeFileSync(destination, output, "utf8");
  records.push({
    source: relative,
    target: path.relative(root, destination).replaceAll(path.sep, "/"),
    kind: "game-data",
    sha256: sha256(Buffer.from(output)),
    topLevel: Array.isArray(parsed) ? "array" : "object",
    recordCount: Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length,
  });
};

for (const file of walk(sourceData).filter((file) => file.endsWith(".json"))) {
  if (sourceRootFileSet.has(path.relative(sourceData, file).replaceAll(path.sep, "/"))) continue;
  copyJson(file);
}
for (const file of walk(path.join(sourceData, "assets"))) {
  const relative = path.relative(sourceData, file).replaceAll(path.sep, "/");
  const destination = path.join(targetAssets, path.basename(file));
  if (!fs.existsSync(destination) || sha256(fs.readFileSync(destination)) !== sha256(fs.readFileSync(file))) {
    fs.copyFileSync(file, destination);
  }
  records.push({
    source: relative,
    target: path.relative(root, destination).replaceAll(path.sep, "/"),
    kind: "game-asset",
    sha256: sha256(fs.readFileSync(destination)),
  });
}

for (const name of sourceRootFiles) {
  const source = path.join(sourceData, name);
  if (!fs.existsSync(source)) continue;
  const destination = path.join(targetRoot, "localization", name);
  mkdir(path.dirname(destination));
  const output = fs.readFileSync(source);
  fs.writeFileSync(destination, output);
  records.push({
    source: name,
    target: path.relative(root, destination).replaceAll(path.sep, "/"),
    kind: "game-localization",
    sha256: sha256(output),
  });
}

const index = {
  schemaVersion: 1,
  sourceRoot: "legacy/data",
  targetRoot: "data/game-content/legacy",
  generatedBy: "tools/migration/migrate-legacy-game-content.mjs",
  counts: {
    json: records.filter((record) => record.kind === "game-data").length,
    assets: records.filter((record) => record.kind === "game-asset").length,
    localization: records.filter((record) => record.kind === "game-localization").length,
  },
  records,
};
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

const dataFiles = JSON.parse(fs.readFileSync(dataFilesPath, "utf8"));
const registered = new Set(dataFiles.files.filter((file) => (
  !file.startsWith("assets/")
  && !file.startsWith("game-content/legacy/")
  && file !== "game-content/legacy-content-index.json"
)));
for (const record of records.filter((record) => record.kind !== "game-asset")) {
  const relative = record.target.slice("data/".length);
  if (!relative.startsWith("game-content/legacy/") && relative !== "game-content/legacy-content-index.json") {
    registered.add(relative);
  }
}
dataFiles.files = [...registered].sort();
fs.writeFileSync(dataFilesPath, `${JSON.stringify(dataFiles, null, 2)}\n`, "utf8");

console.log(`legacy-game-content: ${index.counts.json} JSON, ${index.counts.assets} assets, ${index.counts.localization} localization files`);
console.log(`registered game files: ${dataFiles.files.length}`);
