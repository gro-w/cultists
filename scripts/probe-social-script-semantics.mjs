import assert from "node:assert/strict";
import fs from "node:fs";
import { validateBlueprint } from "../js/core/ScheduleBlueprint.js";

const root = "data/zh-hans";
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8"));
const files = ["social01a", "social01b", "social02a", "social02b", "social03a", "social03b", "social04a", "social04b"];
const docs = Object.fromEntries(files.map((file) => [file, read(`${file}.json`)]));
const expected = {
  social01a: [],
  social01b: ["social01b_ajie_honor_of_kings", "social01b_awei_headphones"],
  social02a: ["social02a_ajie_chat", "social02a_awei_chat"],
  social02b: [],
  social03a: [],
  social03b: ["social03b_ajie_24_personality_high", "social03b_ajie_24_personality_low", "social03b_awei_tail_high", "social03b_awei_tail_low"],
  social04a: ["social04a_ajie_chat", "social04a_awei_chat"],
  social04b: [],
};
for (const file of files) assert.deepEqual(docs[file].entries.map((e) => e.id), expected[file], `${file}: wrong entries`);
const all = files.flatMap((file) => docs[file].entries);
const entry = (id) => all.find((item) => item.id === id);
const values = (e) => Object.values(e.blueprint.nodes).flatMap((n) => [n.inputs?.text, n.inputs?.label0, n.inputs?.label1]).filter(Boolean);
const assertText = (id, ...texts) => { const actual = values(entry(id)); for (const text of texts) assert.ok(actual.some((value) => value.includes(text)), `${id}: missing ${text}`); };

assertText("social01b_ajie_honor_of_kings", "我正好要做测试手游的视频，要不要来跟我一起玩？", "《皇者荣耀》，你玩过没？", "有我带你。况且你现在是新手保护期，不会遇到皇者的。", "所有人都这么想，充点钱就容易了，段位高了，心愿达成了——这么说手游跟教堂有什么区别？都是门口放个箱子收钱。", "没事，死了又不是终点。有些时候，死了还能激发出英雄的第二人格——就像我们一样，有时候得“死”一次才能活出真我。");
assertText("social01b_awei_headphones", "新买的耳机终于到了，来，给你试听一下。", "……还没付尾款。到底听不听？赶紧的。", "但只有我听到第37秒会有。", "我对《月之暗面》比对《外科学》还熟悉，怎么会搞错？", "幻听要去看医生的。");
assertText("social02a_ajie_chat", "回来了？工作累吗？", "累就对了，舒服是留给死人的……哦不，留给神的。", "你要不要借他点钱？");
assertText("social02a_awei_chat", "我去食堂看看有没有剩饭。", "你觉不觉得屋里越来越潮了？");
assertText("social03b_ajie_24_personality_high", "我在做一个测评手游的视频，今天测《第二十四人格》这个手游，我想听听你的意见。", "三重馈赠");
assertText("social03b_ajie_24_personality_low", "什么都不要看，直接玩，玩完告诉我感想。", "充钱就像上供，只能得到保底作为神的恩赐，无法买到你心爱的那张卡……我是说游戏之神。");
assertText("social03b_awei_tail_high", "后天就要到尾款期限了。", "还差五千。", "我只有一千八，可以借给你。", "它越来越清晰了", "怎么给自己开刀做手术");
assertText("social03b_awei_tail_low", "我在想要不要退了。", "肯定还得起，不过是最近手头紧一点。", "你是不是压力太大把两个音频搞混了？");
assertText("social04a_ajie_chat", "很好吃的酸奶", "今晚还打《第二十四人格》吗？", "会影响我刷题的", "那晚上一起打桌游吗？", "待会儿有空我就来。");
assertText("social04a_awei_chat", "后天就要还尾款了。", "你不是明天就要还了吗？");

function control(e, type) { return Object.values(e.blueprint.nodes).find((node) => node.type === type); }
function incoming(e, nodeId, port) { return e.blueprint.connections.filter((c) => c.toNodeId === nodeId && c.toPort === port); }
function gateSources(e, variableId) {
  const p = control(e, "prerequisite");
  const edge = incoming(e, p.id, "condition");
  assert.equal(edge.length, 1, `${e.id}: prerequisite must have one input edge`);
  const seen = new Set();
  const visit = (nodeId) => {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    const node = e.blueprint.nodes[nodeId];
    if (!node) return false;
    if (node.type === "getGlobal") return node.inputs.variableId === variableId;
    return e.blueprint.connections.filter((c) => c.toNodeId === nodeId).some((c) => visit(c.fromNodeId));
  };
  assert.equal(visit(edge[0].fromNodeId), true, `${e.id}: missing public variable ${variableId}`);
}
for (const e of all) {
  const result = validateBlueprint(e.blueprint);
  assert.equal(result.ok, true, `${e.id}: ${result.errors?.join("; ")}`);
  assert.equal(control(e, "prerequisite").outputs && Object.keys(control(e, "prerequisite").outputs).length, 0);
  assert.equal(control(e, "scheduleExpiry").outputs && Object.keys(control(e, "scheduleExpiry").outputs).length, 0);
  assert.equal(control(e, "scheduleExpiry").inputs.expires, true);
}
gateSources(entry("social02a_ajie_chat"), 100);
gateSources(entry("social02a_awei_chat"), 101);
gateSources(entry("social04a_ajie_chat"), 100);
gateSources(entry("social04a_awei_chat"), 101);
for (const id of ["social03b_ajie_24_personality_high", "social03b_ajie_24_personality_low"]) gateSources(entry(id), 40);
for (const id of ["social03b_awei_tail_high", "social03b_awei_tail_low"]) gateSources(entry(id), 41);
const allNodes = all.flatMap((e) => Object.values(e.blueprint.nodes));
assert.ok(allNodes.some((n) => n.type === "setGlobal" && n.inputs.variableId === 0 && n.inputs.delta === 5), "missing suspicion +5 operation");
assert.ok(allNodes.some((n) => n.type === "setGlobal" && n.inputs.variableId === 40 && n.inputs.delta === 5), "missing Ajie favor +5 operation");
assert.ok(allNodes.some((n) => n.type === "setGlobal" && n.inputs.variableId === 41 && n.inputs.delta === 5), "missing Awei favor +5 operation");
const lowAwei = entry("social03b_awei_tail_low");
assert.equal(lowAwei.blueprint.nodes.choice_final_23_op0_suspicion.inputs.delta, 5);
assert.equal(entry("social03b_awei_tail_high").blueprint.nodes.choice_final_24_op0.inputs.variableId, 41);
assert.equal(entry("social04a_ajie_chat").blueprint.nodes.favor_compare.inputs.right, 49);
console.log(`social script semantics probe: ok (${all.length} entries, ${allNodes.length} nodes)`);
