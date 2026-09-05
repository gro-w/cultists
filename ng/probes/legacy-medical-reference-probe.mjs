// Phase 8 slice: legacy `data/zh-hans/diagnoses.json` (114 diagnoses across
// 14 ICD-chapter categories) and `data/zh-hans/medicines.json` (152
// medicines across 18 categories) migrated via
// `ng/tools/migrate-legacy-medical-reference.mjs` into ng's generic
// database/data-structure feature (structures: diagnosis/diagnosisCategory/
// medicine/medicineCategory; databases: diagnoses/diagnosisCategories/
// medicines/medicineCategories) rather than being hardcoded in engine JS —
// this is the shared reference-data foundation the HIS 诊断/开药 window and
// the ChatGTP window (both look up diagnosis/medicine records by id) will
// build on. This probe proves the migrated seed records load and validate
// cleanly against their structures, and spot-checks known legacy content.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const structures = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/structures.json"), "utf8"));
const databases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/databases.json"), "utf8"));
const seedRecords = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/seed-records.json"), "utf8"));

function makeStore() {
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.loadDefinitions(structures);
  const dataStore = new DataStore(dataStructureManager);
  dataStore.loadDefinitions(databases);
  return dataStore;
}

// --- all seeded records validate cleanly against their structures -----------
{
  const dataStore = makeStore();
  for (const [databaseId, records] of Object.entries(seedRecords)) {
    dataStore.loadRecords(databaseId, records); // throws on any validation failure
  }
  assert.equal(dataStore.countRecords("diagnoses"), 114, "114 legacy diagnoses");
  assert.equal(dataStore.countRecords("diagnosisCategories"), 14, "14 legacy ICD chapters");
  assert.equal(dataStore.countRecords("medicines"), 152, "152 legacy medicines");
  assert.equal(dataStore.countRecords("medicineCategories"), 18, "18 legacy medicine categories");
}

// --- known legacy content is preserved (spot checks) ------------------------
{
  const dataStore = makeStore();
  for (const [databaseId, records] of Object.entries(seedRecords)) dataStore.loadRecords(databaseId, records);

  const gastroenteritis = dataStore.getRecord("diagnoses", "infectious_gastroenteritis");
  assert.equal(gastroenteritis.icd10, "A09");
  assert.equal(gastroenteritis.normalName, "感染性胃肠炎和结肠炎，未特指");
  assert.equal(gastroenteritis.categoryId, "icd_a");
  assert.ok(gastroenteritis.applicableMedicineIds.includes("med_043"));

  const category = dataStore.getRecord("diagnosisCategories", "icd_a");
  assert.equal(category.icdChapter, "I");
  assert.equal(category.icdRange, "A00–B99");

  const paracetamol = dataStore.getRecord("medicines", "med_paracetamol");
  assert.equal(paracetamol.name, "对乙酰氨基酚");
  assert.equal(paracetamol.price, 300);
  assert.equal(paracetamol.categoryId, "analgesic");
  assert.ok(paracetamol.applicableDiagnosisIds.includes("headache_unspecified"));

  const medicineCategory = dataStore.getRecord("medicineCategories", "analgesic");
  assert.equal(medicineCategory.name, "解热镇痛药");
  assert.ok(medicineCategory.medicineIds.includes("med_paracetamol"));
}

// --- unknown lookups return null, never fabricate a record ------------------
{
  const dataStore = makeStore();
  for (const [databaseId, records] of Object.entries(seedRecords)) dataStore.loadRecords(databaseId, records);
  assert.equal(dataStore.getRecord("diagnoses", "not_a_real_diagnosis"), null);
  assert.equal(dataStore.getRecord("medicines", "not_a_real_medicine"), null);
}

console.log("legacy-medical-reference-probe: all scenarios passed");
