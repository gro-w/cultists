import assert from "node:assert/strict";
import { scheduleData } from "../js/core/ScheduleData.js";
import { socialQueue } from "../js/core/ScheduleQueue.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart" },
    end: { id: "end", type: "scheduleEnd" },
    gate: { id: "gate", type: "prerequisite", inputs: { condition: false } },
    expiry: { id: "expiry", type: "scheduleExpiry", inputs: { expires: true, expiresAt: 100 } },
  },
  connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
};

scheduleData.scheduleById = new Map([[
  "probe-insert",
  { id: "probe-insert", queueId: "social", blueprint },
]]);
scheduleData.pendingAdds = [];
scheduleData.lastAbsoluteMinute = 0;
socialQueue.restore([]);

const respected = scheduleData.addSchedule("probe-insert", 100, "social");
assert.equal(respected.ok, true);
scheduleData._appendScheduledThrough(100);
assert.equal(socialQueue.getPending().length, 0, "default insertion must respect a false prerequisite");

const bypassed = scheduleData.addSchedule("probe-insert", 120, "social", { respectPrerequisite: false });
assert.equal(bypassed.ok, true);
scheduleData._appendScheduledThrough(120);
assert.equal(socialQueue.getPending().length, 1, "respectPrerequisite=false must bypass the prerequisite");
assert.equal(socialQueue.current().protectFromExpiry, undefined);

const protectedRequest = scheduleData.addSchedule("probe-insert", 140, "social", {
  respectPrerequisite: false,
  protectFromExpiry: true,
});
assert.equal(protectedRequest.ok, true);
scheduleData._appendScheduledThrough(140);
assert.equal(socialQueue.getPending().length, 2);
assert.equal(socialQueue.getPending().at(-1).protectFromExpiry, true);

scheduleData._expireInstances(101);
assert.equal(socialQueue.getPending().length, 1, "unprotected inserted instance must expire");
assert.equal(socialQueue.getPending()[0].protectFromExpiry, true, "protected instance must remain unresolved");

socialQueue.restore([]);
scheduleData.pendingAdds = [];
scheduleData.lastAbsoluteMinute = null;
console.log("schedule insert options probe: ok");
