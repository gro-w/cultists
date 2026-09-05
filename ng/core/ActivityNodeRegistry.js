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
    valueInputs: [valueIn("key", "string"), valueIn("equals"), valueIn("condition", "bool")],
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
  // Ternary value selection (no domain meaning, same "engine stays generic"
  // spirit as `arithmetic`/`branch`): picks `whenTrue`/`whenFalse` based on
  // `condition`, letting a value-graph express e.g. "pick the
  // alphabetically-first of two chosen keyword ids" with only comparison +
  // this node, no dedicated sort/min node.
  conditionalValue: {
    label: "条件取值",
    valueInputs: [valueIn("condition", "bool"), valueIn("whenTrue"), valueIn("whenFalse")],
    valueOutputs: [valueOut("value")],
  },
  getVariable: {
    label: "读取变量",
    valueInputs: [valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
  // Reads one field off an object value (e.g. a `getRecord`/`findRecords`
  // result stored in variableStore) - the generic counterpart to
  // `getVariable` for structured values, so a widget property can display
  // e.g. a selected patient's `name` without a domain-specific node.
  getProperty: {
    label: "读取属性",
    valueInputs: [valueIn("value"), valueIn("key", "string")],
    valueOutputs: [valueOut("value")],
  },
  // Appends one item to the end of an array value (treating a missing/
  // non-array input as empty) - the generic counterpart to `arithmetic`
  // for building up a list purely from value-node wiring, e.g. a "add to
  // prescription"/"pick a keyword" button appending to a variableStore
  // array one click at a time with no domain-specific node type.
  arrayAppend: {
    label: "数组追加",
    valueInputs: [valueIn("array"), valueIn("item")],
    valueOutputs: [valueOut("value")],
  },
  // Public-variable nodes (plan §10). These operate on the typed,
  // ID-addressed PublicVariableManager (0..65535, bool/smallInteger/
  // integer/real/string/object) through `pvGateway`, distinct from the
  // generic per-run `variableStore` string-keyed nodes above.
  getPublicVariable: {
    label: "读取公共变量",
    valueInputs: [valueIn("id", "number")],
    valueOutputs: [valueOut("value")],
  },
  publicVariableCondition: {
    label: "公共变量条件",
    valueInputs: [valueIn("id", "number"), valueIn("op", "string"), valueIn("value")],
    valueOutputs: [valueOut("value", "bool")],
  },
  applyPublicVariableEffect: {
    label: "应用公共变量效果",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("id", "number"), valueIn("value"), valueIn("delta", "number"), valueIn("toggle", "bool"), valueIn("setObjectRef")],
  },
  // Generic narrative-display primitive (Phase 8 legacy content migration):
  // announces a line of text through `eventGateway` (same mechanism as
  // `emitEvent` — no "his-app"/"social-app" enum baked in, `displayTo` is an
  // opaque routing string a window/widget subscribes to) and, only when a
  // `continueKey` is wired, blocks exactly like `blockUntil` until that
  // variable becomes truthy (a widget's onClick blueprint sets it), then
  // resets the key and continues. Omitting `continueKey` auto-advances
  // immediately, for non-interactive/automated narration.
  text: {
    label: "显示文本",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut()],
    valueInputs: [valueIn("speaker", "string"), valueIn("text", "string"), valueIn("displayTo", "string"), valueIn("keywordIds"), valueIn("continueKey", "string")],
  },
  // Generic labeled N-way branch primitive: announces `options` through
  // `eventGateway` for a window/widget to render as buttons, then blocks
  // until `selectionKey` (set by a button's onClick blueprint to the chosen
  // option's index) is a valid integer in [0, optionCount), consumes it
  // (resets to null so a later revisit — e.g. a loop back onto this node —
  // waits for a fresh selection), and branches on the matching `optionN`
  // flow output. `optionN` ports are declared up to a fixed cap (6, well
  // above the legacy corpus's observed max of 3) since Blueprint node types
  // are statically registered; ActivityValidator only requires the first
  // `optionCount` of them to be wired (plan §15 风险 F: still domain-agnostic
  // — nothing here references dialogue/item/medical content).
  choice: {
    label: "选择分支",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("option0"), flowOut("option1"), flowOut("option2"), flowOut("option3"), flowOut("option4"), flowOut("option5")],
    valueInputs: [valueIn("options"), valueIn("optionCount", "number"), valueIn("selectionKey", "string")],
  },
  // Pure value nodes with no flow ports at all (legacy `prerequisite`/
  // `activityExpiry`, ported 1:1): never flow-stepped by the runner, never
  // wired to another node's value input either — future Activity-selection
  // logic (deciding which entries are offered/still valid) finds the one
  // `prerequisite`/`activityExpiry` node in a definition's blueprint (by
  // type, exactly like the legacy engine's `matchesPrerequisites`/expiry
  // check) and reads its `condition`/`expires`/`expiresAt` inputs directly
  // via the same generic `resolveInput` helper flow nodes already use.
  prerequisite: {
    label: "前置条件",
    valueInputs: [valueIn("condition", "bool")],
  },
  activityExpiry: {
    label: "活动过期",
    valueInputs: [valueIn("expires", "bool"), valueIn("expiresAt", "number")],
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
