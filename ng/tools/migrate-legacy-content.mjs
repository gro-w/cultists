import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const sourceDir = path.join(root, "data", "zh-hans");
const targetDir = path.join(root, "ng", "data", "legacy-content", "zh-hans");
const manifestFile = path.join(root, "ng", "data", "legacy-content-manifest.json");

function copyLegacyContent() {
  fs.mkdirSync(targetDir, { recursive: true });
  const files = fs.readdirSync(sourceDir).filter((name) => name.endsWith(".json")).sort();
  const entries = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(sourceDir, file), "utf8"));
    const id = file.slice(0, -5);
    fs.writeFileSync(path.join(targetDir, file), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    entries.push({ id, file: `legacy-content/zh-hans/${file}`, sourceFile: `data/zh-hans/${file}` });
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify({ language: "zh-hans", documents: entries }, null, 2)}\n`, "utf8");
  console.log(`Migrated ${entries.length} legacy JSON documents to ${path.relative(root, targetDir)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) copyLegacyContent();
export { copyLegacyContent };
