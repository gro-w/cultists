// Phase 8 slice 2: flat/self-contained legacy reference domains — NPCs,
// skills, keywords, locations, achievements (+ achievement categories) —
// migrated verbatim from data/zh-hans/{npcs,skills,keywords,locations,
// achievements}.json into data/structures.framework.json + data/databases.framework.json
// + data/databases/<databaseId>.json, loaded at boot through the new generic
// `DataStore.loadRecordSet()` seed-content loader (game-manifest.json's
// `seedRecords` key), exactly like the existing structures/databases/
// publicVariables config-driven loaders.
//
// The previously deferred domains are now included in the seed/runtime
// parity checks below: item investigate/use activities, ending activities,
// and the hierarchical medicines/diagnoses reference tables.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../data");
const structures = JSON.parse(fs.readFileSync(path.join(dataDir, "structures.framework.json"), "utf8"));
const databases = JSON.parse(fs.readFileSync(path.join(dataDir, "databases.framework.json"), "utf8"));
const seedRecords = Object.fromEntries(databases.map(({ databaseId, recordFile }) => {
  const value = JSON.parse(fs.readFileSync(path.join(dataDir, recordFile), "utf8"));
  return [databaseId, value[databaseId] || []];
}));
const migratedDir = path.join(__dirname, "../data/game-content/legacy/zh-hans");

function legacy(file) {
  const migratedPath = path.join(migratedDir, file);
  return JSON.parse(fs.readFileSync(migratedPath, "utf8"));
}

function boot() {
  const dsm = new DataStructureManager();
  dsm.loadDefinitions(structures);
  const ds = new DataStore(dsm);
  ds.loadDefinitions(databases);
  ds.loadRecordSet(seedRecords);
  return ds;
}

// --- seed file loads with no validation errors, one record per legacy row --
{
  const ds = boot();
  const legacyNpcs = legacy("npcs.json").npcs;
  const legacySkills = legacy("skills.json").skills;
  const legacyKeywords = legacy("keywords.json").keywords;
  const legacyLocations = legacy("locations.json").locations;
  const legacyAchievements = legacy("achievements.json").achievements;
  const legacyCategories = legacy("achievements.json").categories;

  assert.equal(ds.countRecords("npcs"), legacyNpcs.length);
  assert.equal(ds.countRecords("skills"), legacySkills.length);
  assert.equal(ds.countRecords("keywords"), legacyKeywords.length);
  assert.equal(ds.countRecords("locations"), legacyLocations.length);
  assert.equal(ds.countRecords("achievements"), legacyAchievements.length);
  assert.equal(ds.countRecords("achievementCategories"), Object.keys(legacyCategories).length);
}

// --- field-level fidelity spot checks ---------------------------------------
{
  const ds = boot();

  // npc: nested portrait/endingPortrait arrays preserved as-is (generic
  // "object"-accepting "array" field, no lossy flattening).
  const ajie = ds.getRecord("npcs", "ajie");
  assert.equal(ajie.name, "阿杰");
  assert.equal(ajie.initialFavorability, 60);
  assert.equal(ajie.initialSan, 80);
  assert.equal(ajie.portraits.length, 1);
  assert.equal(ajie.portraits[0].imageData, "data/assets/npc_ajie_portraits_0_6f62a86edebb.png");
  assert.equal(ajie.endingPortraits.length, 2);
  assert.equal(ajie.endingPortraits[0].endingId, "游戏王の福利");

  // skill: numericid preserved (legacy skill-point public variables 20-39
  // are indexed by this numeric id, not the string id).
  const observation = ds.getRecord("skills", "observation");
  assert.equal(observation.numericid, 0);
  assert.equal(observation.label, "细致观察");

  // keyword: optional contentLowSan/relatedIds default to safe empties when
  // absent in the legacy row, present values pass through unchanged.
  const fever = ds.getRecord("keywords", "fever");
  assert.equal(fever.content, "发热");
  assert.deepEqual(fever.relatedIds, []);
  const mysteryNote = ds.getRecord("keywords", "mystery_note");
  assert.equal(mysteryNote.contentLowSan, "血迹斑斑的诅咒字符");
  assert.ok(mysteryNote.relatedIds.includes("roommate_necklace_clue"));

  // location: nested subLocations/backgroundImages arrays preserved.
  const dorm = ds.getRecord("locations", "dorm");
  assert.equal(dorm.name, "宿舍");
  assert.equal(dorm.subLocations.length, 5);
  assert.equal(dorm.subLocations[0].id, "player_desk");
  assert.equal(dorm.backgroundImage, "data/assets/location_dorm_ecf66b3d164a.jpg");

  // achievement: free-form `trigger` object (generic "object" field type)
  // round-trips exactly, including once/progress/target/condition shapes.
  const studyKing = ds.getRecord("achievements", "study_king");
  assert.deepEqual(studyKing.trigger, { event: "game:study", progress: true, target: 3 });
  const sanFastDrop = ds.getRecord("achievements", "san_fast_drop");
  assert.equal(sanFastDrop.sanDropThreshold, 10);
  assert.deepEqual(sanFastDrop.trigger.condition, { delta: { lte: -10 } });

  const category = ds.getRecord("achievementCategories", "sanity");
  assert.equal(category.label, "理智值");
}

// --- formerly deferred domains retain their authored counts and activity
// payloads ---------------------------------------------------------------
{
  const ds = boot();
  const legacyItems = legacy("items.json").items;
  const ngItems = JSON.parse(fs.readFileSync(path.join(dataDir, "databases/inventoryItems.json"), "utf8")).inventoryItems;
  assert.equal(ngItems.length, legacyItems.length);
  assert.equal(ngItems.reduce((sum, item) => sum + Object.keys(item.activities || {}).length, 0), legacyItems.reduce((sum, item) => sum + Object.keys(item.activities || {}).length, 0));

  const legacyDiagnoses = legacy("diagnoses.json");
  const legacyMedicines = legacy("medicines.json");
  assert.equal(ds.countRecords("diagnoses"), legacyDiagnoses.categories.reduce((sum, category) => sum + category.diagnoses.length, 0));
  assert.equal(ds.countRecords("medicines"), legacyMedicines.medicines.length);
  assert.equal(ds.countRecords("diagnosisCategories"), legacyDiagnoses.categories.length);
  assert.equal(ds.countRecords("medicineCategories"), legacyMedicines.categories.length);

  const endingFiles = fs.readdirSync(path.join(dataDir, "activities")).filter((file) => file.startsWith("ending__") && file.endsWith(".json"));
  assert.equal(endingFiles.length, 15);
  for (const file of endingFiles) assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, "activities", file), "utf8")).blueprint);
}

// --- getRecord/findRecords never return the live seeded record (clone-on-
// read invariant from DataStore's doc comment) even for seed-loaded rows --
{
  const ds = boot();
  const first = ds.getRecord("npcs", "ajie");
  first.name = "mutated";
  const second = ds.getRecord("npcs", "ajie");
  assert.equal(second.name, "阿杰");
}

console.log("legacy-reference-data-probe: all assertions passed");
