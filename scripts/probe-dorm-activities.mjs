import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(`data/zh-hans/${name}`, root), "utf8"));
const dormMode = fs.readFileSync(new URL("js/desktop/DormMode.js", root), "utf8");
assert.match(dormMode, /socialQueue\.getPending\(\)\s*\.filter\(\(item\) => !\(item\.payload\?\.npcId \|\| item\.payload\?\.actorId\)/, "dorm must render NPC-less social activities");
assert.match(dormMode, /_showActivityDialogue\(definition, item\)/, "activity button must reuse the activity dialogue runner");
assert.match(dormMode, /eventBus\.on\("activity:appended"/, "dorm must refresh after a activity is inserted");
const social = read("socialpub.json").entries;
const activities = social.filter((entry) => entry.id.startsWith("dorm_activity_day"));
assert.equal(activities.length, 4, "four weekday dorm activities expected");
const byDay = new Map(activities.map((entry) => [entry.day, entry]));
for (let day = 1; day <= 4; day += 1) {
  const entry = byDay.get(day);
  assert.ok(entry, `missing dorm activity day ${day}`);
  const bp = entry.blueprint;
  assert.equal(bp.nodes.prerequisite.inputs.condition, true);
  assert.ok(bp.nodes.choice, `day ${day} needs study/activity choice`);
  assert.ok(bp.nodes.choice.options[1].condition.any, `day ${day} activity option needs favorability gate`);
  assert.equal(bp.nodes.study_time.inputs.minutes, 20);
  assert.equal(bp.nodes.study_san.inputs.statId, "mental");
  assert.equal(bp.nodes.study_san.inputs.delta, 10);
  assert.equal(bp.nodes.activity_set.inputs.variableId, 103 + day);
  assert.ok(Object.values(bp.nodes).some((node) => node.type === "activityExpiry"));
}
const day2 = byDay.get(2).blueprint;
assert.equal(day2.nodes.day1_activity.inputs.variableId, 104);
const day3 = byDay.get(3).blueprint;
assert.equal(day3.nodes.previous_activity.inputs.variableId, 105);
assert.deepEqual(
  [day3.nodes.check_0.inputs.variableId, day3.nodes.check_1.inputs.variableId, day3.nodes.check_2.inputs.variableId],
  [109, 110, 111],
);
const day4 = byDay.get(4).blueprint;
assert.deepEqual(
  [day4.nodes.check_0.inputs.variableId, day4.nodes.check_1.inputs.variableId, day4.nodes.check_2.inputs.variableId, day4.nodes.check_3.inputs.variableId],
  [113, 110, 111, 112],
);
assert.equal(day3.nodes.suspicion.inputs.variableId, 0);
assert.equal(day3.nodes.suspicion.inputs.delta, 10);
assert.equal(day4.nodes.suspicion.inputs.variableId, 0);
assert.equal(day4.nodes.suspicion.inputs.delta, 10);
for (const [day, file] of [[1, "social01b.json"], [2, "social02b.json"], [3, "social03b.json"], [4, "social04b.json"]]) {
  const entries = read(file).entries;
  assert.ok(entries.some((entry) => entry.blueprint?.nodes?.insert_dorm_activity?.inputs?.activityId === `dorm_activity_day${day}`), `day ${day} invitation insertion missing`);
}
const day5 = read("social05a.json").entries;
assert.equal(day5.length, 1);
assert.equal(day5[0].id, "dorm_activity_day5");
assert.ok(Object.values(day5[0].blueprint.nodes).some((node) => node.type === "activityEnd"));
const globals = read("global_variables.json");
for (const id of [104, 105, 106, 107, 109, 110, 111, 112, 113]) assert.ok(globals.some((entry) => entry.id === id), `missing global ${id}`);
console.log("dorm activity probe: ok");
