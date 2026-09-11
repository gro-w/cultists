import fs from "node:fs";

const source = fs.readFileSync(new URL("../js/desktop/DevDialogueEditorTab.js", import.meta.url), "utf8");
const exportBlock = source.match(/_activityToGame\(activity\)\s*\{([\s\S]*?)\n\s*\}\n\s*_eventFileToGame/);
if (!exportBlock) throw new Error("Could not locate _activityToGame");
if (!/entry\.blueprint/.test(exportBlock[1])) {
  throw new Error("_activityToGame must export the canonical entry.blueprint");
}
if (/entry\.dialogueTree\)/.test(exportBlock[1])) {
  throw new Error("_activityToGame still exports the legacy dialogueTree");
}
const loadBlock = source.match(/this\.project\.activities\[name\]\s*= \{([\s\S]*?)\n\s*\}\)\s*\};/);
if (!loadBlock || !/blueprint:\s*this\._normalizeGameTree\(entry\.blueprint/.test(loadBlock[1])) {
  throw new Error("activity loading must normalize legacy input into blueprint");
}
console.log("editor blueprint single-source probe passed");
