import fs from "node:fs";
import ItemManager from "../core/ItemManager.js";
import SpellManager from "../core/SpellManager.js";

const records = JSON.parse(fs.readFileSync(new URL("../data/seed-records-items.json", import.meta.url), "utf8")).inventoryItems;
const itemManager = new ItemManager();
const gameState = { mental: 15 };
const spellManager = new SpellManager({ gameState });
if (itemManager.loadDefinitions(records) !== 29) throw new Error("item definition count mismatch");
if (spellManager.loadDefinitions(itemManager.allDefinitions()) !== 5) throw new Error("spell definition count mismatch");
itemManager.add("book_nahan");
if (!itemManager.canUse("book_nahan")) throw new Error("usable book was not recognized");
const spellId = "book_nahan__0";
spellManager.learn(spellId);
const cast = spellManager.cast(spellId);
if (!cast.ok || cast.cost !== 10 || gameState.mental !== 5) throw new Error("spell cast cost was not applied");
if (spellManager.cast(spellId).ok !== false) throw new Error("insufficient SAN was not rejected");
console.log("item-spell-migration-probe: ok", JSON.stringify({ items: itemManager.allDefinitions().length, spells: spellManager.allDefinitions().length }));
