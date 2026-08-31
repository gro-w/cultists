import fs from "node:fs";

const manager = fs.readFileSync(new URL("../js/core/SpellManager.js", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../js/core/ActivityRunner.js", import.meta.url), "utf8");
const learn = manager.match(/learn\(spell\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
if (!/applyLearn\(spell\)/.test(manager)) throw new Error("SpellManager must expose applyLearn for activity execution");
if (/activity:triggered/.test(learn)) throw new Error("learn must not trigger an activity before its timed activity runs");
if (!/effects\.spellOperation\(/.test(runner)) throw new Error("spellOperation must apply learning through the activity boundary");
console.log("spell learning activity boundary probe passed");
