import { createDefaultNodeRegistry } from "../core/ScheduleNodeRegistry.js";
import { ScheduleValidator } from "../core/ScheduleValidator.js";
const validator = new ScheduleValidator(createDefaultNodeRegistry());
const base = { id: "schema", nodes: [{ id: "start", type: "start" }, { id: "end", type: "end" }], connections: [{ id: "edge", from: { node: "start", port: "next" }, to: { node: "end", port: "in" } }] };
if (!validator.validate(base).valid) throw new Error("schema probe rejected valid graph");
if (validator.validate({ ...base, nodes: [{ id: "start", type: "unknown" }, base.nodes[1]] }).valid) throw new Error("unknown node accepted");
if (validator.validate({ ...base, nodes: [{ id: "start", type: "start" }, { id: "start", type: "end" }] }).valid) throw new Error("duplicate node accepted");
console.log("PASS: blueprint schema valid, unknown node and duplicate ID rejected");
