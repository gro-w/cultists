import assert from "node:assert/strict";
import { activityData } from "../js/core/ActivityData.js";
import { socialQueue } from "../js/core/ActivityQueue.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart" },
    end: { id: "end", type: "activityEnd" },
    gate: { id: "gate", type: "prerequisite", inputs: { condition: false } },
    expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: true, expiresAt: 100 } },
  },
  connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
};

activityData.activityById = new Map([[
  "probe-insert",
  { id: "probe-insert", queueId: "social", blueprint },
]]);
activityData.pendingAdds = [];
activityData.lastAbsoluteMinute = 0;
socialQueue.restore([]);

const respected = activityData.addActivity("probe-insert", 100, "social");
assert.equal(respected.ok, true);
activityData._appendQueuedThrough(100);
assert.equal(socialQueue.getPending().length, 0, "default insertion must respect a false prerequisite");

const bypassed = activityData.addActivity("probe-insert", 120, "social", { respectPrerequisite: false });
assert.equal(bypassed.ok, true);
activityData._appendQueuedThrough(120);
assert.equal(socialQueue.getPending().length, 1, "respectPrerequisite=false must bypass the prerequisite");
assert.equal(socialQueue.current().protectFromExpiry, undefined);

const protectedRequest = activityData.addActivity("probe-insert", 140, "social", {
  respectPrerequisite: false,
  protectFromExpiry: true,
});
assert.equal(protectedRequest.ok, true);
activityData._appendQueuedThrough(140);
assert.equal(socialQueue.getPending().length, 2);
assert.equal(socialQueue.getPending().at(-1).protectFromExpiry, true);

activityData._expireInstances(101);
assert.equal(socialQueue.getPending().length, 1, "unprotected inserted instance must expire");
assert.equal(socialQueue.getPending()[0].protectFromExpiry, true, "protected instance must remain unresolved");

socialQueue.restore([]);
activityData.pendingAdds = [];
activityData.lastAbsoluteMinute = null;
console.log("activity insert options probe: ok");
