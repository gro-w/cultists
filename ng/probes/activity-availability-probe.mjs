import assert from "node:assert/strict";
import { evaluateActivityAvailability } from "../core/ActivityAvailabilityEvaluator.js";

const clock = { day: 1, minutes: 40, snapshot() { return { day: this.day, minutes: this.minutes }; } };
const context = {
  gameClock: clock,
  variableStore: { get: () => undefined },
  evaluateCondition: () => true,
};
const definition = {
  id: "gated",
  blueprint: {
    nodes: {
      start: { id: "start", type: "flowStart" },
      gate: { id: "gate", type: "prerequisite", inputs: { condition: true } },
      expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: false, expiresAt: 100 } },
      end: { id: "end", type: "activityEnd" },
    },
    startNodeId: "start",
  },
};
assert.equal(evaluateActivityAvailability(definition, context).ok, true);
definition.blueprint.nodes.gate.inputs.condition = false;
assert.equal(evaluateActivityAvailability(definition, context).reason, "prerequisite");
definition.blueprint.nodes.gate.inputs.condition = true;
clock.minutes = 100;
assert.equal(evaluateActivityAvailability(definition, context).reason, "expired");
console.log("activity-availability probe: ok");
