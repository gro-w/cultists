import assert from "node:assert/strict";
import { displayReceiverManager } from "../js/core/DisplayReceiverManager.js";
import { getActivityNodeDefinition } from "../js/core/ActivityNodeRegistry.js";

assert.deepEqual(
  getActivityNodeDefinition("text").valueInputs.map((port) => port.name),
  ["speaker", "text", "displayTo"],
);
let received = null;
const off = displayReceiverManager.register("probe-target", (payload) => { received = payload; });
assert.equal(displayReceiverManager.dispatch("probe-target", { type: "text", text: "收到" }), true);
assert.equal(received.text, "收到");
off();
assert.equal(displayReceiverManager.dispatch("probe-target", { type: "text", text: "未收到" }), false);
console.log("display receiver routing passed");
