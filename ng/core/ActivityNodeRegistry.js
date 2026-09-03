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
  loop: {
    label: "循环",
    flowInputs: [flowIn()],
    flowOutputs: [flowOut("body"), flowOut("done")],
    valueInputs: [valueIn("times", "number")],
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
};

export const ACTIVITY_NODE_TYPES = Object.freeze(Object.keys(definitions));

export function getActivityNodeDefinition(type) {
  return definitions[type] || null;
}

export function isFlowNode(type) {
  const def = getActivityNodeDefinition(type);
  return Boolean(def && (def.flowInputs?.length || def.flowOutputs?.length));
}

export default definitions;
