// Phase 8 slice: legacy `data/zh-hans/global_variables.json` (111 entries,
// system-reserved ids 0..99 per AGENTS.md) migrated verbatim (same ids,
// same defaults) into ng/data/public-variables.json, typed onto
// PublicVariableManager's existing bool/smallInteger/real types (no new
// engine concepts). This probe proves the migrated file loads cleanly and
// preserves the reserved-id semantics documented in AGENTS.md, plus that
// the two pre-existing demo entries (moved off ids 0/1 to make room) still
// work unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicVariableManager } from "../core/PublicVariableManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const definitions = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/public-variables.json"), "utf8"));

// --- file loads and registers with no id collisions -------------------------
{
  const pv = new PublicVariableManager();
  pv.loadDefinitions(definitions);
  assert.equal(pv.list().length, 113, "111 legacy entries + 2 demo entries");
  const ids = pv.list().map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
}

// --- AGENTS.md reserved-id semantics (0..99 system reserved) ----------------
{
  const pv = new PublicVariableManager();
  pv.loadDefinitions(definitions);

  // id 1 = 主角SAN, id 2 = 金钱, id 5 = ChatGTP SAN
  assert.equal(pv.definition(1).name, "主角SAN");
  assert.equal(pv.get(1), 100);
  assert.equal(pv.definition(2).name, "金钱");
  assert.equal(pv.definition(2).type, "real");
  assert.equal(pv.definition(5).name, "ChatGTP SAN");
  assert.equal(pv.get(5), 80);

  // 20..39 = 主角技能点, 40..59 = NPC 好感度, 60..79 = NPC SAN
  for (let id = 20; id <= 39; id++) assert.equal(pv.definition(id).name.startsWith("主角技能"), true, `id ${id} should be a skill point slot`);
  for (let id = 40; id <= 59; id++) assert.equal(pv.definition(id).name.includes("好感度"), true, `id ${id} should be a favorability slot`);
  for (let id = 60; id <= 79; id++) assert.equal(pv.definition(id).name.includes("SAN"), true, `id ${id} should be an NPC SAN slot`);

  // every legacy "number"-typed slot must fit ng's smallInteger 0..255 bound
  // (AGENTS.md: "number/decimal 范围 0..256") without the manager clamping it.
  for (const def of pv.list()) {
    if (def.type === "smallInteger") assert.ok(pv.get(def.id) >= 0 && pv.get(def.id) <= 255);
  }
}

// --- demo entries survive the renumbering off ids 0/1 ------------------------
{
  const pv = new PublicVariableManager();
  pv.loadDefinitions(definitions);
  const clockVar = pv.definition(1000);
  assert.equal(clockVar.name, "gameTimeMinutes");
  assert.equal(clockVar.syncSource, "gameClock.totalMinutes");
  const invVar = pv.definition(1001);
  assert.equal(invVar.name, "playerInventoryFocus");
  assert.equal(invVar.objectTarget, "database:inventoryItems");
}

console.log("legacy-public-variables-probe: all assertions passed");
