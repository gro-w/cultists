import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataRoot = path.join(root, "ng", "data");
const databaseDir = path.join(dataRoot, "databases");
const definitionPath = path.join(dataRoot, "databases.framework.json");
const manifestPath = path.join(dataRoot, "game-manifest.json");
const sourceFiles = ["seed-records.json", "seed-records-items.json"];
const allRecords = {};
for (const file of sourceFiles) {
  const sourcePath = path.join(dataRoot, file);
  if (!fs.existsSync(sourcePath)) continue;
  Object.assign(allRecords, JSON.parse(fs.readFileSync(sourcePath, "utf8")));
}
const definitions = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
for (const definition of definitions) {
  if (allRecords[definition.databaseId]) continue;
  const existingPath = path.join(dataRoot, definition.recordFile || "");
  if (existingPath && fs.existsSync(existingPath)) {
    const value = JSON.parse(fs.readFileSync(existingPath, "utf8"));
    allRecords[definition.databaseId] = value[definition.databaseId] || [];
  }
}
fs.mkdirSync(databaseDir, { recursive: true });
const files = [];
for (const definition of definitions) {
  const records = allRecords[definition.databaseId] || [];
  const file = `databases/${definition.databaseId}.json`;
  fs.writeFileSync(path.join(dataRoot, file), `${JSON.stringify({ [definition.databaseId]: records }, null, 2)}\n`, "utf8");
  definition.recordFile = file;
  files.push(file);
}
fs.writeFileSync(definitionPath, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.seedRecords = files;
manifest.deferredSeedRecords = [];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`split-database-record-files: ${files.length} databases -> ${databaseDir}`);
