const FLOW = "flow";
const VALUE = "value";
const ANY = "any";

const input = (name, kind = VALUE, type = ANY) => ({ name, kind, type });
const flowIn = () => input("flowIn", FLOW, null);
const flowOut = (name = "flowOut") => ({ name, kind: FLOW, type: null });

const definitions = {
  flowStart: { label: "流程起始", flowOutputs: [flowOut()] },
  text: { label: "显示文字", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("speaker"), input("text", VALUE, "string")] },
  choice: { label: "点击分支", flowInputs: [flowIn()], flowOutputs: [], valueInputs: [input("branchCount", VALUE, "number")] },
  branch: { label: "逻辑分支", flowInputs: [flowIn()], flowOutputs: [flowOut("false"), flowOut("true")], valueInputs: [input("condition")] },
  consumeTime: { label: "消耗时间", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("minutes", VALUE, "number")] },
  setGlobal: { label: "操作公共变量", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("variableId"), input("value")] },
  insertSchedule: { label: "插入日程", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("scheduleId", VALUE, "string"), input("addTime", VALUE, "number"), input("queue", VALUE, "string")] },
  showCg: { label: "显示 CG", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("cgId", VALUE, "string")] },
  inventoryOperation: { label: "操作背包", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("itemId", VALUE, "string"), input("count", VALUE, "number")] },
  statOperation: { label: "操作数值", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("statId", VALUE, "string"), input("delta", VALUE, "number")] },
  arithmetic: { label: "运算", valueInputs: [input("operator", VALUE, "string"), input("left"), input("right")], valueOutputs: [{ name: "value", kind: VALUE, type: ANY }] },
  getGlobal: { label: "公共变量取值", valueInputs: [input("variableId")], valueOutputs: [{ name: "value", kind: VALUE, type: ANY }] },
  getInventory: { label: "背包取值", valueInputs: [input("itemId", VALUE, "string")], valueOutputs: [{ name: "value", kind: VALUE, type: "number" }] },
  getProtagonistStat: { label: "主角数值取值", valueInputs: [input("statId", VALUE, "string")], valueOutputs: [{ name: "value", kind: VALUE, type: ANY }] },
  getScheduleStatus: { label: "日程状态", valueInputs: [input("instanceId", VALUE, "string")], valueOutputs: [{ name: "value", kind: VALUE, type: "number" }] },
  getScheduleInstanceCount: { label: "日程实例数量", valueInputs: [input("scheduleId", VALUE, "string")], valueOutputs: [{ name: "value", kind: VALUE, type: "number" }] },
  getGameTime: { label: "当前游戏时间", valueOutputs: [{ name: "value", kind: VALUE, type: "number" }] },
};

export const SCHEDULE_NODE_TYPES = Object.freeze(Object.keys(definitions));

export function getScheduleNodeDefinition(type) {
  return definitions[type] || null;
}

export function getScheduleNodePort(type, portName, direction, node = null) {
  const def = getScheduleNodeDefinition(type);
  if (!def) return null;
  if (type === "choice" && direction === "output" && /^option\d+$/.test(portName)) return { name: portName, kind: FLOW, type: null };
  if (type === "choice" && direction === "input" && /^label\d+$/.test(portName)) return { name: portName, kind: VALUE, type: "string" };
  const ports = direction === "input"
    ? [...(def.flowInputs || []), ...(def.valueInputs || [])]
    : [...(def.flowOutputs || []), ...(def.valueOutputs || [])];
  return ports.find((port) => port.name === portName) || null;
}

export function isFlowNode(type) {
  const def = getScheduleNodeDefinition(type);
  return Boolean(def && (def.flowInputs?.length || def.flowOutputs?.length));
}

export function isValueNode(type) {
  const def = getScheduleNodeDefinition(type);
  return Boolean(def && def.valueOutputs?.length);
}

export default definitions;
