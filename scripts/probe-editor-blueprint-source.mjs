import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/desktop/DevDialogueEditorTab.js", import.meta.url), "utf8");
const exportBlock = source.match(/_scheduleToGame\(schedule\)\s*\{([\s\S]*?)\n\s*\}\n\s*_eventFileToGame/);
if (!exportBlock) throw new Error("Could not locate _scheduleToGame");
if (!/entry\.blueprint/.test(exportBlock[1])) {
  throw new Error("_scheduleToGame must export the canonical entry.blueprint");
}
if (/entry\.dialogueTree\)/.test(exportBlock[1])) {
  throw new Error("_scheduleToGame still exports the legacy dialogueTree");
}
const loadBlock = source.match(/this\.project\.schedules\[name\]\s*= \{([\s\S]*?)\n\s*\}\)\s*\};/);
if (!loadBlock || !/blueprint:\s*this\._normalizeGameTree\(entry\.blueprint/.test(loadBlock[1])) {
  throw new Error("schedule loading must normalize legacy input into blueprint");
}
console.log("editor blueprint single-source probe passed");
