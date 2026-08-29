import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { createScheduleRunner } = await import("../js/core/ScheduleRunner.js");
const { socialQueue } = await import("../js/core/ScheduleQueue.js");
const { globalVariableManager } = await import("../js/core/GlobalVariableManager.js");
const { gameState } = await import("../js/core/GameState.js");
const { timeService } = await import("../js/core/TimeService.js");

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this._html = ""; }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { this.listeners.click?.(); }
  set textContent(value) { this._text = String(value); }
  get textContent() { return this._text || ""; }
}
globalThis.document = { createElement: (tag) => new Element(tag) };

const root = "data/zh-hans";
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8"));
const definitions = [
  ...read("socialpub.json").entries.filter((entry) => entry.id.startsWith("dorm_activity_day")),
  ...read("social05a.json").entries,
];
globalVariableManager.replaceDefinitions(read("global_variables.json"), { emit: false });
for (const id of [40, 41, 42]) globalVariableManager.set(id, 100, { emit: false });
timeService.config = {};

for (const definition of definitions) {
  const day = Number(definition.id.match(/day(\d+)/)?.[1] || 1);
  gameState.restore({ day, clockMinutes: 16 * 60, phase: "night", duty: "off-duty", location: "dorm", sanity: 100, roommateSuspicion: 0 });
  timeService.startPhase("night", 0);
  socialQueue.restore([]);
  const instance = socialQueue.append([{ ...structuredClone(definition), scheduleId: `${definition.id}:probe` }])[0];
  const optionsEl = new Element("div");
  const lines = [];
  const runner = createScheduleRunner({
    definition: instance,
    instance,
    optionsEl,
    appendLine: (_speaker, label, text) => lines.push(`${label}:${text}`),
    onCheckpoint: (current) => socialQueue.updateInstance(current.instanceId, current),
    onComplete: (current) => socialQueue.complete(current.instanceId),
  });
  runner.start();
  if (definition.id !== "dorm_activity_day5") {
    assert.ok(optionsEl.children.length >= 2, `${definition.id}: initial choice missing`);
    optionsEl.children[1].click();
  }
  while (instance.status !== "resolved") {
    const button = optionsEl.children[0];
    assert.ok(button, `${definition.id}: stopped at ${instance.currentNodeId}, after ${lines.length} lines`);
    button.click();
  }
  assert.equal(socialQueue.statusOf(instance.instanceId), "resolved");
  assert.equal(instance.currentNodeId, null);
  console.log(`${definition.id}: resolved (${lines.length} lines)`);
}

for (const definition of definitions.filter((entry) => entry.id !== "dorm_activity_day5")) {
  const day = Number(definition.id.match(/day(\d+)/)?.[1] || 1);
  gameState.restore({ day, clockMinutes: 16 * 60, phase: "night", duty: "off-duty", location: "dorm", sanity: 100, roommateSuspicion: 0 });
  timeService.startPhase("night", 0);
  socialQueue.restore([]);
  const instance = socialQueue.append([{ ...structuredClone(definition), scheduleId: `${definition.id}:study-probe` }])[0];
  const optionsEl = new Element("div");
  const runner = createScheduleRunner({ definition: instance, instance, optionsEl,
    appendLine: () => {}, onCheckpoint: (current) => socialQueue.updateInstance(current.instanceId, current),
    onComplete: (current) => socialQueue.complete(current.instanceId) });
  runner.start();
  assert.ok(optionsEl.children[0], `${definition.id}: study choice missing`);
  optionsEl.children[0].click();
  while (instance.status !== "resolved") {
    assert.ok(optionsEl.children[0], `${definition.id}: study stopped at ${instance.currentNodeId}`);
    optionsEl.children[0].click();
  }
  assert.equal(socialQueue.statusOf(instance.instanceId), "resolved");
  assert.equal(globalVariableManager.get(103 + day), true, `${definition.id}: study branch must set activity state`);
}
console.log("dorm activity resolution probe: ok");
