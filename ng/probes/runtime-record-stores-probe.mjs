import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import RuntimeRecordStore from "../core/RuntimeRecordStore.js";
import ItemManager from "../../tools/ng-legacy-content/ItemManager.js";
import SpellManager from "../../tools/ng-legacy-content/SpellManager.js";

const eventBus = new EventBus();
const items = new ItemManager({ eventBus }); items.define({ id: "key" }); items.add("key"); items.place("desk", "key"); assert.equal(items.pickUp("desk").itemId, "key"); assert.equal(items.count("key"), 2);
const npcs = new RuntimeRecordStore({ eventBus, eventPrefix: "npc" }); npcs.set("npc", { favorability: 3 }); assert.equal(npcs.get("npc").favorability, 3);
const spells = new SpellManager({ eventBus }); spells.learn("spell"); assert.equal(spells.isLearned("spell"), true);
const outcomes = new RuntimeRecordStore({ eventBus, eventPrefix: "outcome" }); assert.equal(outcomes.set("ending", { unlocked: true }).unlocked, true);
const selections = new RuntimeRecordStore({ eventBus, eventPrefix: "selection" }); selections.set("session", { selected: "patient", submitted: true });
const media = new RuntimeRecordStore({ eventBus, eventPrefix: "media" }); media.set("cg", { unlocked: true }); media.set("bgm", { playing: true });
const snapshots = [items, npcs, spells, outcomes, selections, media].map((store) => store.snapshot());
assert.equal(snapshots.length, 6);
console.log("runtime-record-stores probe: ok");
