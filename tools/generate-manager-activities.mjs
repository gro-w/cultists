import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const calendar = JSON.parse(fs.readFileSync(path.join(root, "activity-calendar.json"), "utf8"));

function buildManager(id, displayName, slots) {
  const nodes = { start: { id: "start", type: "flowStart", inputs: {} } };
  const connections = [];
  const addConnection = (fromNodeId, fromPort, toNodeId, toPort) => connections.push({ id: `edge-${connections.length + 1}`, fromNodeId, fromPort, toNodeId, toPort });
  const ids = slots.map((_, index) => `slot-${index + 1}`);
  slots.forEach((slot, index) => {
    const prefix = ids[index];
    const nextPrefix = ids[index + 1];
    const waitId = `${prefix}-wait`;
    const dueId = `${prefix}-due`;
    const insertId = `${prefix}-insert`;
    const nextWaitId = nextPrefix ? `${nextPrefix}-wait` : "end";
    const absoluteMinutes = (Number(slot.day) - 1) * 1440 + Number(slot.minutes);
    nodes[waitId] = { id: waitId, type: "blockUntil", inputs: { condition: { nodeId: dueId, port: "value" } } };
    nodes[dueId] = { id: dueId, type: "publicVariableCondition", inputs: { id: 1000, op: "gte", value: absoluteMinutes } };
    nodes[insertId] = { id: insertId, type: "insertActivity", inputs: { activityId: slot.activityId, queueId: slot.queueId, payload: { autoRun: true, scheduled: { day: slot.day, minutes: slot.minutes } } } };
    const previousId = index === 0 ? "start" : `${ids[index - 1]}-insert`;
    addConnection(previousId, "flowOut", waitId, "flowIn");
    addConnection(dueId, "value", waitId, "condition");
    if (!slot.prerequisites) {
      nodes[waitId].next = { flowOut: { nodeId: insertId, port: "flowIn" } };
    } else {
      const prerequisites = Array.isArray(slot.prerequisites.globalVariables)
        ? slot.prerequisites.globalVariables
        : slot.prerequisites.globalVariables ? [slot.prerequisites.globalVariables] : [];
      const checks = prerequisites.map((condition, checkIndex) => {
        const checkId = `${prefix}-prerequisite-${checkIndex + 1}`;
        nodes[checkId] = { id: checkId, type: "publicVariableCondition", inputs: condition };
        return checkId;
      });
      let conditionRef = checks[0] ? { nodeId: checks[0], port: "value" } : false;
      for (let checkIndex = 1; checkIndex < checks.length; checkIndex += 1) {
        const andId = `${prefix}-prerequisite-and-${checkIndex}`;
        nodes[andId] = { id: andId, type: "arithmetic", inputs: { operator: "and", left: conditionRef, right: { nodeId: checks[checkIndex], port: "value" } } };
        conditionRef = { nodeId: andId, port: "value" };
      }
      const branchId = `${prefix}-prerequisite-branch`;
      nodes[branchId] = { id: branchId, type: "branch", inputs: { condition: conditionRef }, next: { true: { nodeId: insertId, port: "flowIn" }, false: { nodeId: nextWaitId, port: "flowIn" } } };
      nodes[waitId].next = { flowOut: { nodeId: branchId, port: "flowIn" } };
    }
    nodes[insertId].next = { flowOut: { nodeId: nextWaitId, port: "flowIn" } };
  });
  nodes.end = { id: "end", type: "activityEnd", inputs: {} };
  return { id, displayName, type: "manager", blueprint: { startNodeId: "start", nodes, connections } };
}

for (const [queueId, id, displayName] of [
  ["work", "patient-queue-manager", "患者队列管理器"],
  ["social", "social-story-manager", "室友剧情管理器"],
]) {
  const slots = calendar.slots.filter((slot) => slot.queueId === queueId).sort((a, b) => ((a.day - 1) * 1440 + a.minutes) - ((b.day - 1) * 1440 + b.minutes));
  fs.writeFileSync(path.join(root, "activities", `${id}.json`), `${JSON.stringify(buildManager(id, displayName, slots), null, 2)}\n`, "utf8");
}
