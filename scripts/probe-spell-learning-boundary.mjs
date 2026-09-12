import fs from "node:fs";

const manager = fs.readFileSync(new URL("../js/core/SpellManager.js", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../js/core/ScheduleRunner.js", import.meta.url), "utf8");
const learn = manager.match(/learn\(spell\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
if (!/applyLearn\(spell\)/.test(manager)) throw new Error("SpellManager must expose applyLearn for schedule execution");
if (/schedule:triggered/.test(learn)) throw new Error("learn must not trigger an schedule before its timed schedule runs");
if (!/effects\.spellOperation\(/.test(runner)) throw new Error("spellOperation must apply learning through the schedule boundary");
console.log("spell learning schedule boundary probe passed");
