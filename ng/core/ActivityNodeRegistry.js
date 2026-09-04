/**
 * ActivityNodeRegistry - the generic, domain-agnostic Blueprint node types
 * available in ng/ Phase 2. Per the plan's risk mitigation (§15 风险 F),
 * this registry must never grow "item"/"medical"/"dialogue"-specific node
 * types; those arrive later as data-driven Activity *content*, not new
 * node types baked into the engine.
 */
const FLOW = "flow";
const VALUE = "value";

const flowIn = (name = "flowIn") => ({ name, kind: FLOW });
const flowOut = (name = "flowOut") => ({ name, kind: FLOW });
const valueIn = (name, type = "any") => ({ name, kind: VALUE, type });
const valueOut = (name = "value", type = "any") => ({ name, kind: VALUE, type });

const definitions = {
  flowStart: { label: "流程起始", flowOutputs: [flowOut()] },
  activityEnd: { label: "活动结束", flowInputs: [flowIn()] },
  setVariable: {
    label: "设置变量",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("value"), valueIn("delta", "number")],
  },
  branch: {
    label: "条件分支",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("true"), flowOut("false")],
    valueInputs: [valueIn("condition", "bool")],
  },
  blockUntil: {
    label: "阻塞直到",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("key", "string"), valueIn("equals")],
  },
  consumeTime: {
    label: "消耗时间",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("minutes", "number")],
  },
  // Generic window-kernel action (not domain logic - windows/WindowManager
  // are core engine concepts per plan §4/§7). Lets a blueprint (e.g. a
  // desktop icon's) open a window definition by id and then keep going,
  // e.g. into a consumeTime node - see plan §7.4's "下班" example flow.
  openWindow: {
    label: "打开窗口",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("windowId", "string")],
  },
  // Generic Activity-queue action (plan §8.3 "desktop.run-activity"):
  // enqueues and runs another Activity definition on a given queue, without
  // the caller needing to know anything about that Activity's own flow.
  runActivity: {
    label: "运行 Activity",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("activityId", "string"), valueIn("queueId", "string")],
  },
  // Generic event-bus action (plan §8.3 "desktop.emit-event"): lets a
  // blueprint announce a domain-agnostic event other systems can subscribe
  // to, without baking any specific event name into the engine.
  emitEvent: {
    label: "发出事件",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("eventName", "string"), valueIn("payload")],
  },
  // Generic database CRUD actions (plan §9.3). Every result is written into
  // `variableStore` under the node's own `resultVariable` input - the same
  // "write into a well-known variable, then read it with getVariable/
  // {variable}" convention already used for widget event values - rather
  // than inventing a second value-output wiring path for side-effecting
  // flow nodes.
  createRecord: {
    label: "创建记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("data"), valueIn("resultVariable", "string")],
  },
  getRecord: {
    label: "读取记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("resultVariable", "string")],
  },
  updateRecord: {
    label: "更新记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("patch"), valueIn("resultVariable", "string")],
  },
  deleteRecord: {
    label: "删除记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("key"), valueIn("resultVariable", "string")],
  },
  findRecords: {
    label: "查找记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("query"), valueIn("resultVariable", "string")],
  },
  countRecords: {
    label: "统计记录",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("databaseId", "string"), valueIn("query"), valueIn("resultVariable", "string")],
  },
  // Pure value nodes: no flow ports at all. They are never flow-stepped by
  // the ActivityRunner; instead they are evaluated on demand whenever
  // another node's value input is wired to one of their value outputs
  // (plan §6.2 value-port wiring). Kept intentionally domain-agnostic
  // (arithmetic + generic variable read) per §15 风险 F.
  arithmetic: {
    label: "运算",
    valueInputs: [valueIn("operator", "string"), valueIn("left"), valueIn("right")],
    valueOutputs: [valueOut("value")],
  },
  getVariable: {
    label: "读取变量",
    valueInputs: [valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
};

export const ACTIVITY_NODE_TYPES = Object.freeze(Object.keys(definitions));

export function getActivityNodeDefinition(type) {
  return definitions[type] || null;
}

export function isFlowNode(type) {
  const def = getActivityNodeDefinition(type);
  return Boolean(def && (def.flowInputs?.length || def.flowOutputs?.length));
}

/** Find a flow port descriptor (direction "input"|"output") by name, or null. Used by the Activity editor + validator so port lookup logic lives in one place. */
export function findFlowPort(type, direction, name) {
  const def = getActivityNodeDefinition(type);
  const list = direction === "input" ? def?.flowInputs : def?.flowOutputs;
  return (list || []).find((port) => port.name === name) || null;
}

/** Find a value port descriptor (direction "input"|"output") by name, or null. */
export function findValuePort(type, direction, name) {
  const def = getActivityNodeDefinition(type);
  const list = direction === "input" ? def?.valueInputs : def?.valueOutputs;
  return (list || []).find((port) => port.name === name) || null;
}

/**
 * Find any port (flow or value, direction "input"|"output") by name. This is
 * the one lookup the editor + validator should use when a connection could
 * legally be either kind, since a plain findFlowPort() lookup would silently
 * report "no such port" for a value port with the same name.
 */
export function getActivityNodePort(type, direction, name) {
  return findFlowPort(type, direction, name) || findValuePort(type, direction, name);
}

/** All ports of a node in a given direction (flow first, then value), in stable declaration order. Used by the editor to lay out port rows. */
export function listActivityNodePorts(type, direction) {
  const def = getActivityNodeDefinition(type);
  if (!def) return [];
  return direction === "input" ? [...(def.flowInputs || []), ...(def.valueInputs || [])] : [...(def.flowOutputs || []), ...(def.valueOutputs || [])];
}

/**
 * Two ports are connectable only if their `kind` matches (flow-to-flow,
 * value-to-value) and, for value ports, their `type` matches unless either
 * side declares "any". Flow ports carry no `type`, so kind equality alone
 * is sufficient for them (§6.3 "端口类型兼容").
 */
export function arePortsCompatible(portA, portB) {
  if (!portA || !portB) return false;
  if (portA.kind !== portB.kind) return false;
  if (portA.kind === VALUE && portA.type !== "any" && portB.type !== "any" && portA.type !== portB.type) return false;
  return true;
}

export default definitions;
