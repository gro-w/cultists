// Phase 8 slice: legacy `data/zh-hans/chatgtp_qa.json` (48,195 keyword-combo
// -> answer entries) migrated via `ng/tools/migrate-legacy-chatgtp-qa.mjs`
// into ng's generic database (structure `chatgtpQaEntry`, database
// `chatgtpQaEntries`), stored in its own seed file
// (`ng/data/seed-records-chatgtp.json`) merged at boot alongside the main
// `seed-records.json` via `engine.json`'s now-array-capable `seedRecords`
// key. This probe proves the migrated data loads/validates cleanly at full
// scale, spot-checks a known legacy entry, and proves the multi-file
// seedRecords merge itself (both files loading into the same DataStore
// with no id collisions across domains).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { entryKey } from "../tools/migrate-legacy-chatgtp-qa.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const structures = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/structures.json"), "utf8"));
const databases = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/databases.json"), "utf8"));
const engineConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/engine.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/chatgtp-settings.json"), "utf8"));

function makeStore() {
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.loadDefinitions(structures);
  const dataStore = new DataStore(dataStructureManager);
  dataStore.loadDefinitions(databases);
  return dataStore;
}

// --- engine.json's seedRecords is the array this migration relies on ------
assert.ok(Array.isArray(engineConfig.seedRecords), "engine.json seedRecords must be an array to merge multiple seed files");
assert.ok(engineConfig.seedRecords.includes("seed-records-chatgtp.json"));

// --- every seed file merges into the same DataStore with no collisions ----
{
  const dataStore = makeStore();
  for (const seedFile of engineConfig.seedRecords) {
    const records = JSON.parse(fs.readFileSync(path.join(__dirname, "../data", seedFile), "utf8"));
    dataStore.loadRecordSet(records); // throws on any validation failure or duplicate key
  }
  assert.equal(dataStore.countRecords("chatgtpQaEntries"), 48195, "all 48,195 legacy QA entries migrated");
  assert.ok(dataStore.countRecords("keywords") > 0, "unrelated domain from the other seed file still loads");
}

// --- known legacy content preserved, keyed by the same sorted-id convention ---
{
  const dataStore = makeStore();
  for (const seedFile of engineConfig.seedRecords) {
    const records = JSON.parse(fs.readFileSync(path.join(__dirname, "../data", seedFile), "utf8"));
    dataStore.loadRecordSet(records);
  }
  const key = entryKey(["med_090"]);
  const entry = dataStore.getRecord("chatgtpQaEntries", key);
  assert.ok(entry, "single-keyword entry for med_090 must exist");
  assert.ok(entry.answer.includes("贝那普利"));
  assert.deepEqual(entry.keywords, ["med_090"]);

  // combo lookup is order-independent (sorted key), matching legacy behaviour
  const comboEntries = (JSON.parse(fs.readFileSync(path.join(__dirname, "../data/seed-records-chatgtp.json"), "utf8"))).chatgtpQaEntries;
  const twoKeywordSample = comboEntries.find((e) => e.keywords.length === 2);
  assert.ok(twoKeywordSample, "dataset must contain at least one 2-keyword combo entry");
  const forward = entryKey(twoKeywordSample.keywords);
  const reversed = entryKey([...twoKeywordSample.keywords].reverse());
  assert.equal(forward, reversed, "keyword order must not affect the lookup key");
  assert.equal(dataStore.getRecord("chatgtpQaEntries", forward).id, twoKeywordSample.id);
}

// --- settings file carries the non-per-entry scalar knobs -------------------
{
  assert.equal(settings.sanCostPerQuery, 2);
  assert.ok(settings.offlineAnswer.length > 0);
  assert.ok(Array.isArray(settings.revealKeywordIds) && settings.revealKeywordIds.length > 0);
}

// --- unknown combo returns null, never fabricates an answer -----------------
{
  const dataStore = makeStore();
  for (const seedFile of engineConfig.seedRecords) {
    const records = JSON.parse(fs.readFileSync(path.join(__dirname, "../data", seedFile), "utf8"));
    dataStore.loadRecordSet(records);
  }
  assert.equal(dataStore.getRecord("chatgtpQaEntries", entryKey(["not_a_real_keyword_xyz"])), null);
}

console.log("legacy-chatgtp-qa-probe: all scenarios passed");
