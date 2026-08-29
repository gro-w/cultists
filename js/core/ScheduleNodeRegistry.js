const FLOW = "flow";
const VALUE = "value";
const ANY = "any";

const input = (name, kind = VALUE, type = ANY) => ({ name, kind, type });
const flowIn = () => input("flowIn", FLOW, null);
const flowOut = (name = "flowOut") => ({ name, kind: FLOW, type: null });

const definitions = {
  flowStart: { label: "流程起始", flowOutputs: [flowOut()] },
  scheduleEnd: { label: "日程结束", flowInputs: [flowIn()] },
  text: { label: "显示文字", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("speaker"), input("text", VALUE, "string")] },
  choice: { label: "点击分支", flowInputs: [flowIn()], flowOutputs: [], valueInputs: [input("branchCount", VALUE, "number")] },
  randomBranch: { label: "随机分支", flowInputs: [flowIn()], flowOutputs: [], valueInputs: [input("n", VALUE, "number")] },
  branch: { label: "逻辑分支", flowInputs: [flowIn()], flowOutputs: [flowOut("false"), flowOut("true")], valueInputs: [input("condition")] },
  waitUntil: { label: "阻塞直到", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("condition", VALUE, "bool")] },
  diceCheck: { label: "骰子检定", flowInputs: [flowIn()], flowOutputs: [flowOut("largeSuccess"), flowOut("success"), flowOut("failure"), flowOut("largeFailure")], valueInputs: [input("n", VALUE, "number")] },

  consumeTime: { label: "消耗时间", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("minutes", VALUE, "number")] },
  setGlobal: { label: "操作公共变量", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("variableId"), input("value"), input("delta", VALUE, "number")] },
  ending: { label: "触发结局", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("endingId", VALUE, "string")] },
  insertSchedule: { label: "插入日程", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("scheduleId", VALUE, "string"), input("addTime", VALUE, "number"), input("queue", VALUE, "string"), input("respectPrerequisite", VALUE, "bool"), input("protectFromExpiry", VALUE, "bool")] },
  showCg: { label: "显示 CG", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("cgId", VALUE, "string")] },
  endCg:  { label: "结束 CG", flowInputs: [flowIn()], flowOutputs: [flowOut()] },
  showImage: { label: "显示图片", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("image", VALUE, "string")] },
  segmentBranch: { label: "分段分支", flowInputs: [flowIn()], flowOutputs: [flowOut("segment0")], valueInputs: [input("value", VALUE, "number"), input("branchCount", VALUE, "number"), input("boundary0", VALUE, "number")] },
  inventoryOperation: { label: "操作背包", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("itemId", VALUE, "string"), input("count", VALUE, "number")] },
  statOperation: { label: "操作主角数值", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("statId", VALUE, "string"), input("delta", VALUE, "number")] },
  spellOperation: { label: "调整法术状态", flowInputs: [flowIn()], flowOutputs: [flowOut()] },
  spellCast: { label: "施放法术", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("spellId", VALUE, "string"), input("target", VALUE, "string"), input("eventId", VALUE, "string"), input("choiceId", VALUE, "string")] },
  spellEffect: { label: "法术后续效果", flowInputs: [flowIn()], flowOutputs: [flowOut()], valueInputs: [input("spellId", VALUE, "string"), input("target", VALUE, "string"), input("eventId", VALUE, "string"), input("choiceId", VALUE, "string")] },
  arithmetic: { label: "运算", valueInputs: [input("operator", VALUE, "string"), input("left"), input("right")], valueOutputs: [{ name: "value", kind: VALUE, type: ANY }] },
  getGlobal: { label: "公共变量取值", valueInputs: [input("variableId")], valueOutputs: [{ name: "value", kind: VALUE, type: ANY }] },
  prerequisite: { label: "先决条件", valueInputs: [input("condition", VALUE, "bool")] },
  scheduleExpiry: { label: "日程过期", valueInputs: [input("expires", VALUE, "bool"), input("expiresAt", VALUE, "number")] },
  getInventory: { label: "背包取值", valueInputs: [input("itemId", VALUE, "string")], valueOutputs: [{ name: "value", kind: VALUE, type: "number" }] },

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
  if (type === "segmentBranch") {
    const match = /^(segment|boundary)(\d+)$/.exec(portName);
    if (match) {
      const index = Number(match[2]);
      const count = Number.isInteger(Number(node?.inputs?.branchCount))
        ? Math.max(1, Math.min(32, Number(node.inputs.branchCount)))
        : 1;
      if (match[1] === "segment" && direction === "output" && index < count) return { name: portName, kind: FLOW, type: null };
      if (match[1] === "boundary" && direction === "input" && index <= count) return { name: portName, kind: VALUE, type: "number" };
      return null;
    }
  }
  if (type === "randomBranch" && /^flowOut\d+$/.test(portName)) {
    const index = Number(portName.slice("flowOut".length));
    const count = node && Number.isInteger(Number(node.inputs?.n))
      ? Math.max(0, Math.min(32, Number(node.inputs.n)))
      : index + 1;
    return index >= 0 && index < count ? { name: portName, kind: FLOW, type: null } : null;
  }
  if (type === "choice" && /^(option|label)\d+$/.test(portName)) {
    const index = Number(portName.replace(/\D/g, ''));
    const count = node && Number.isInteger(Number(node.inputs?.branchCount))
      ? Math.max(0, Math.min(32, Number(node.inputs.branchCount)))
      : (node?.options?.length ?? index + 1);
    if (index >= count) return null;
    if (direction === "output" && portName.startsWith("option")) return { name: portName, kind: FLOW, type: null };
    if (direction === "input" && portName.startsWith("label")) return { name: portName, kind: VALUE, type: "string" };
  }
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
