import { validateBlueprint } from "../js/core/ScheduleBlueprint.js";
import { ScheduleValueEvaluator } from "../js/core/ScheduleValueEvaluator.js";
import ScheduleQueue from "../js/core/ScheduleQueue.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    end: { id: "end", type: "scheduleEnd", inputs: {}, outputs: {} },
    prerequisite: { id: "prerequisite", type: "prerequisite", inputs: { condition: true }, outputs: {} },
    expiry: { id: "expiry", type: "scheduleExpiry", inputs: { expires: true, expiresAt: 100 }, outputs: {} },
  },
  connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
};
const checked = validateBlueprint(blueprint);
if (!checked.ok) throw new Error(checked.errors.join("; "));
const evaluator = new ScheduleValueEvaluator(checked.blueprint);
if (evaluator.evaluateNode("expiry", "value") !== true || Number(evaluator.readInput("expiry", "expiresAt")) !== 100) throw new Error("expiry inputs failed");
const disabled = structuredClone(blueprint);
disabled.nodes.expiry.inputs.expires = false;
if (new ScheduleValueEvaluator(disabled).evaluateNode("expiry", "value") !== false) throw new Error("disabled expiry failed");
const duplicate = structuredClone(blueprint);
duplicate.nodes.expiry2 = { id: "expiry2", type: "scheduleExpiry", inputs: { expires: true, expiresAt: 200 }, outputs: {} };
if (validateBlueprint(duplicate).ok) throw new Error("duplicate expiry node accepted");
const queue = new ScheduleQueue("probe");
const [instance] = queue.append({ id: "expiry-probe", scheduleId: "expiry-probe", blueprint });
if (!queue.expire(instance.instanceId) || queue.statusOf(instance.instanceId) !== "resolved" || queue.getInstance(instance.instanceId).resolutionReason !== "expired") throw new Error("expiry resolution failed");
console.log("schedule expiry probe: ok");
