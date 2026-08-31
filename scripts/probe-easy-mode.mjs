import assert from "node:assert/strict";
import fs from "node:fs";
import { isEasyModeSearch, selectWorkEntries } from "../js/core/GameMode.js";

assert.equal(isEasyModeSearch("?easy"), true);
assert.equal(isEasyModeSearch("?dev"), false);
assert.equal(isEasyModeSearch("?easy&x=1"), false);
assert.equal(isEasyModeSearch(""), false);

const entries = Array.from({ length: 5 }, (_, index) => ({ id: `entry-${index}` }));
assert.deepEqual(selectWorkEntries(entries, true).map((entry) => entry.id), ["entry-0", "entry-1", "entry-2"]);
assert.deepEqual(selectWorkEntries(entries, false), entries);
assert.deepEqual(selectWorkEntries(entries.slice(0, 2), true), entries.slice(0, 2));

for (const file of fs.readdirSync("data/zh-hans")) {
  if (/^work\d{2}[ab]\.json$/.test(file)) {
    const document = JSON.parse(fs.readFileSync(`data/zh-hans/${file}`, "utf8"));
    assert.ok(Array.isArray(document.entries), `${file} entries must be an array`);
  }
}

const activityData = fs.readFileSync("js/core/ActivityData.js", "utf8");
assert.match(activityData, /selectWorkEntries\(this\.slots\.get\(key\) \|\| \[\], queueId\)/);
console.log("easy mode probe: ok");
