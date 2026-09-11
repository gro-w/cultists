import { validateBlueprint } from "../js/core/ActivityBlueprint.js";
import { ActivityValueEvaluator } from "../js/core/ActivityValueEvaluator.js";
import ActivityQueue from "../js/core/ActivityQueue.js";

const blueprint = {
  startNodeId: "start",
  nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {} },
    end: { id: "end", type: "activityEnd", inputs: {}, outputs: {} },
    prerequisite: { id: "prerequisite", type: "prerequisite", inputs: { condition: true }, outputs: {} },
    expiry: { id: "expiry", type: "activityExpiry", inputs: { expires: true, expiresAt: 100 }, outputs: {} },
  },
  connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }],
};
const checked = validateBlueprint(blueprint);
if (!checked.ok) throw new Error(checked.errors.join("; "));
const evaluator = new ActivityValueEvaluator(checked.blueprint);
if (evaluator.readInput("expiry", "expires", false) !== true || Number(evaluator.readInput("expiry", "expiresAt")) !== 100) throw new Error("expiry inputs failed");
const disabled = structuredClone(blueprint);
disabled.nodes.expiry.inputs.expires = false;
if (new ActivityValueEvaluator(disabled).readInput("expiry", "expires", false) !== false) throw new Error("disabled expiry failed");
const duplicate = structuredClone(blueprint);
duplicate.nodes.expiry2 = { id: "expiry2", type: "activityExpiry", inputs: { expires: true, expiresAt: 200 }, outputs: {} };
if (validateBlueprint(duplicate).ok) throw new Error("duplicate expiry node accepted");
const queue = new ActivityQueue("probe");
const [instance] = queue.append({ id: "expiry-probe", activityId: "expiry-probe", blueprint });
if (!queue.expire(instance.instanceId) || queue.statusOf(instance.instanceId) !== "resolved" || queue.getInstance(instance.instanceId).resolutionReason !== "expired") throw new Error("expiry resolution failed");
console.log("activity expiry probe: ok");
