import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { createActivityRunner } = await import("../js/core/ActivityRunner.js");
const { workQueue } = await import("../js/core/ActivityQueue.js");
const { globalVariableManager } = await import("../js/core/GlobalVariableManager.js");

const data = JSON.parse(fs.readFileSync("data/zh-hans/workpub.json", "utf8"));
const globals = JSON.parse(fs.readFileSync("data/zh-hans/global_variables.json", "utf8"));
const definition = data.entries.find((entry) => entry.id === "medical_complaint_work");
assert.ok(definition, "complaint blueprint missing");
globalVariableManager.replaceDefinitions(globals, { emit: false });

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this._html = ""; }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { this.listeners.click?.(); }
  set textContent(value) { this._text = String(value); }
  get textContent() { return this._text || ""; }
}
globalThis.document = { createElement: (tag) => new Element(tag) };

const old22 = globalVariableManager.get(22);
globalVariableManager.set(22, 100);
workQueue.restore([]);
const instance = workQueue.append([{
  ...JSON.parse(JSON.stringify(definition)),
  kind: "medicalIncident",
  incidentType: "complaint",
  receivedDay: 2,
  receivedTime: 480,
  activityId: "medical_complaint_work:probe",
}])[0];
const optionsEl = new Element("div");
const lines = [];
const runner = createActivityRunner({
  definition: instance,
  instance,
  optionsEl,
  appendLine: (_speaker, label, text) => lines.push(`${label}:${text}`),
  random: () => 0,
  onCheckpoint: (current) => workQueue.updateInstance(current.instanceId, current),
  onComplete: (current) => workQueue.complete(current.instanceId),
});
runner.start();
while (instance.status !== "resolved") {
  const button = optionsEl.children[0];
  assert.ok(button, `runner stopped before resolve at ${instance.currentNodeId}`);
  button.click();
}
assert.equal(workQueue.statusOf(instance.instanceId), "resolved");
assert.equal(instance.currentNodeId, null);
assert.ok(lines.length >= 3);
if (old22 !== undefined) globalVariableManager.set(22, old22);
console.log("medical complaint resolution probe: ok");
