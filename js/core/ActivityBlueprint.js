import { getActivityNodeDefinition, getActivityNodePort, isFlowNode, isValueNode } from "./ActivityNodeRegistry.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nodeEntries(nodes) {
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return [];
  return Object.entries(nodes);
}

function normalizeNode(node, id) {
  const normalized = { ...clone(node), id: node?.id || id, inputs: { ...(node?.inputs || {}) }, outputs: { ...(node?.outputs || {}) } };
  if (!normalized.type && normalized.speaker !== undefined) normalized.type = "text";
  return normalized;
}

export function normalizeBlueprint(raw) {
  const source = raw?.blueprint || raw || {};
  const nodes = Object.fromEntries(nodeEntries(source.nodes).map(([id, node]) => [id, normalizeNode(node, id)]));
  const connections = Array.isArray(source.connections) ? source.connections.map((connection) => ({ ...connection })) : [];
  const startNodeId = source.startNodeId || source.start || Object.values(nodes).find((node) => node.type === "flowStart")?.id || null;
  return { nodes, connections, startNodeId };
}

function portKind(port) {
  return port?.kind || null;
}

export function validateBlueprint(raw) {
  const blueprint = normalizeBlueprint(raw);
  const errors = [];
  const entries = nodeEntries(blueprint.nodes);
  const prerequisites = entries.filter(([, node]) => node.type === "prerequisite");
  if (prerequisites.length !== 1) errors.push(`蓝图必须有且只有一个先决条件节点，当前为 ${prerequisites.length} 个`);
  prerequisites.forEach(([id, node]) => {
    const definition = getActivityNodeDefinition(node.type);
    if (definition?.flowInputs?.length || definition?.flowOutputs?.length) errors.push(`先决条件节点不能有流程引脚：${id}`);
  });
  const expiries = entries.filter(([, node]) => node.type === "activityExpiry");
  if (expiries.length !== 1) errors.push(`蓝图必须有且只有一个活动过期节点，当前为 ${expiries.length} 个`);
  expiries.forEach(([id, node]) => {
    const definition = getActivityNodeDefinition(node.type);
    if (definition?.flowInputs?.length || definition?.flowOutputs?.length) errors.push(`活动过期节点不能有流程引脚：${id}`);
  });
  const starts = entries.filter(([, node]) => node.type === "flowStart");
  if (starts.length !== 1) errors.push(`流程起始节点必须恰好有一个，当前为 ${starts.length} 个`);
  if (!blueprint.startNodeId || !blueprint.nodes[blueprint.startNodeId]) errors.push("缺少有效的流程起始节点");
  if (blueprint.startNodeId && blueprint.nodes[blueprint.startNodeId]?.type !== "flowStart") errors.push("流程起点必须是起点节点");
  const ends = entries.filter(([, node]) => node.type === "activityEnd");
  if (!ends.length) errors.push("流程必须至少有一个活动结束节点");

  for (const [id, node] of entries) {
    if (!getActivityNodeDefinition(node.type)) errors.push(`节点 ${id} 使用未知类型 ${node.type}`);
    const hasFlowOutput = Boolean(getActivityNodeDefinition(node.type)?.flowOutputs?.length || node.type === "segmentBranch");
    const hasValueOutput = Boolean(getActivityNodeDefinition(node.type)?.valueOutputs?.length);
    if (hasFlowOutput && hasValueOutput) errors.push(`节点 ${id} 不能同时拥有流程输出和数值输出`);
    if (node.id !== id) errors.push(`节点键 ${id} 与节点 id ${node.id} 不一致`);
    if (node.type === "randomBranch" && Object.prototype.hasOwnProperty.call(node.inputs || {}, "n")) {
      const count = node.inputs.n;
      const dynamic = count && typeof count === "object";
      if (!dynamic && (!Number.isSafeInteger(count) || count < 1 || count > 32)) errors.push(`随机分支 ${id} 的 n 必须是 1–32 的整数`);
      else if (!dynamic) for (let index = 0; index < count; index += 1) {
        if (!blueprint.connections.some((connection) => connection.fromNodeId === id && connection.fromPort === `flowOut${index}`)) errors.push(`随机分支 ${id} 的 flowOut${index} 未连接`);
      }
    }
  }

  const reachable = new Set();
  const pending = blueprint.startNodeId ? [blueprint.startNodeId] : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const connection of blueprint.connections) {
      if (connection.fromNodeId === id && portKind(getActivityNodePort(blueprint.nodes[id]?.type, connection.fromPort, "output", blueprint.nodes[id])) === "flow") {
        pending.push(connection.toNodeId);
      }
    }
    const node = blueprint.nodes[id];
    if (node?.next && blueprint.nodes[node.next]) pending.push(node.next);
    for (const option of node?.options || []) if (option.next && blueprint.nodes[option.next]) pending.push(option.next);
  }
  entries.forEach(([id, node]) => {
    if ((isFlowNode(node.type) || node.type === "segmentBranch") && !reachable.has(id)) errors.push(`流程节点 ${id} 不可从流程起始到达`);
    if ((isFlowNode(node.type) || node.type === "segmentBranch") && node.type !== "activityEnd") {
      const hasNext = blueprint.connections.some((connection) => connection.fromNodeId === id && portKind(getActivityNodePort(node.type, connection.fromPort, "output", node)) === "flow")
        || Boolean(node.next)
        || Boolean(node.normalNext || node.abnormalNext)
        || (node.type === "choice" && (node.options || []).some((option) => option.next));
      if (!hasNext) errors.push(`流程终点 ${id} 必须是活动结束节点`);
    }
  });

  blueprint.connections.forEach((connection, index) => {
    const from = blueprint.nodes[connection.fromNodeId];
    const to = blueprint.nodes[connection.toNodeId];
    if (!from || !to) { errors.push(`连接 ${index} 引用了不存在的节点`); return; }
    const sourcePort = getActivityNodePort(from.type, connection.fromPort, "output", from);
    const targetPort = getActivityNodePort(to.type, connection.toPort, "input", to);
    if (!sourcePort) errors.push(`连接 ${index} 的输出引脚不存在`);
    if (!targetPort) errors.push(`连接 ${index} 的输入引脚不存在`);
    if (sourcePort && targetPort && (portKind(sourcePort) !== portKind(targetPort) || (portKind(sourcePort) !== "flow" && targetPort.type !== "any" && sourcePort.type !== "any" && sourcePort.type !== targetPort.type))) {
      errors.push(`连接 ${index} 的引脚类型不匹配`);
    }
  });
  return { ok: errors.length === 0, errors, blueprint };
}

export function embedLegacyPrerequisite(rawBlueprint, legacyPrerequisite) {
  const blueprint = normalizeBlueprint(rawBlueprint);
  if (!legacyPrerequisite || Object.values(blueprint.nodes).some((node) => node.type === "prerequisite")) return blueprint;
  const old = normalizeBlueprint(legacyPrerequisite);
  const oldReturn = Object.values(old.nodes).find((node) => node.type === "returnValue");
  if (!oldReturn) return blueprint;
  Object.entries(old.nodes).forEach(([id, node]) => {
    if (id !== oldReturn.id && !blueprint.nodes[id]) blueprint.nodes[id] = clone(node);
  });
  const nodeId = "__prerequisite__";
  blueprint.nodes[nodeId] = { id: nodeId, type: "prerequisite", inputs: {}, outputs: {}, x: oldReturn.x ?? 80, y: oldReturn.y ?? 260 };
  const incoming = old.connections.find((connection) => connection.toNodeId === oldReturn.id && connection.toPort === "condition");
  if (incoming && blueprint.nodes[incoming.fromNodeId]) blueprint.connections.push({ ...incoming, toNodeId: nodeId });
  else if (Object.prototype.hasOwnProperty.call(oldReturn.inputs || {}, "condition")) blueprint.nodes[nodeId].inputs.condition = oldReturn.inputs.condition;
  return blueprint;
}

const PREREQUISITE_NODE_TYPES = new Set([
  "arithmetic", "getGlobal", "getInventory", "getActivityStatus",
  "getActivityInstanceCount", "getGameTime", "returnValue",
]);

export function validatePrerequisiteBlueprint(raw) {
  const blueprint = normalizeBlueprint(raw);
  const errors = [];
  const entries = nodeEntries(blueprint.nodes);
  const returns = entries.filter(([, node]) => node.type === "returnValue");
  if (returns.length !== 1) errors.push(`先决条件必须有且仅有一个返回值节点，当前为 ${returns.length} 个`);
  if (!entries.length) errors.push("先决条件蓝图不能为空");
  for (const [id, node] of entries) {
    const definition = getActivityNodeDefinition(node.type);
    if (!PREREQUISITE_NODE_TYPES.has(node.type)) errors.push(`先决条件节点 ${id} 类型不允许：${node.type}`);
    if (definition?.flowInputs?.length || definition?.flowOutputs?.length) errors.push(`先决条件蓝图不能包含流程引脚：${id}`);
    if (node.id !== id) errors.push(`节点键 ${id} 与节点 id ${node.id} 不一致`);
  }
  if (returns[0]) {
    const returnNode = returns[0][1];
    const connection = blueprint.connections.find((item) => item.toNodeId === returnNode.id && item.toPort === "condition");
    const source = connection && blueprint.nodes[connection.fromNodeId];
    if (connection && (!source || !getActivityNodePort(source.type, connection.fromPort, "output", source))) errors.push("返回值节点的输入连接无效");
    if (!connection && !Object.prototype.hasOwnProperty.call(returnNode.inputs || {}, "condition")) errors.push("返回值节点必须接收一个条件值");
  }
  blueprint.connections.forEach((connection, index) => {
    const from = blueprint.nodes[connection.fromNodeId];
    const to = blueprint.nodes[connection.toNodeId];
    if (!from || !to) { errors.push(`先决条件连接 ${index} 引用了不存在的节点`); return; }
    const sourcePort = getActivityNodePort(from.type, connection.fromPort, "output", from);
    const targetPort = getActivityNodePort(to.type, connection.toPort, "input", to);
    if (!sourcePort || sourcePort.kind !== "value" || !targetPort || targetPort.kind !== "value") errors.push(`先决条件连接 ${index} 必须是数值连接`);
    else if (targetPort.type !== "any" && sourcePort.type !== "any" && targetPort.type !== sourcePort.type) errors.push(`先决条件连接 ${index} 的数值类型不匹配`);
  });
  return { ok: errors.length === 0, errors, blueprint };
}

export function createEmptyPrerequisiteBlueprint() {
  return { nodes: { return: { id: "return", type: "returnValue", inputs: { condition: false }, outputs: {}, x: 420, y: 120 } }, connections: [] };
}

export function migrateDialogueTree(tree) {
  const source = clone(tree) || {};
  const nodes = { start: { id: "start", type: "flowStart", inputs: {}, outputs: {} } };
  const connections = [];
  Object.entries(source.nodes || {}).forEach(([id, node]) => {
    const textId = `text:${id}`;
    nodes[textId] = { ...node, id: textId, type: "text", inputs: { speaker: node.speaker || "npc", text: node.text || "", displayTo: node.displayTo || node.inputs?.displayTo || "dorm-bottom" }, outputs: {} };
    if (id === source.start) connections.push({ fromNodeId: "start", fromPort: "flowOut", toNodeId: textId, toPort: "flowIn" });
    const options = Array.isArray(node.options) ? node.options : [];
    if (options.length) {
      const choiceId = `choice:${id}`;
      nodes[choiceId] = { id: choiceId, type: "choice", inputs: {}, outputs: {}, options: options.map((option, index) => ({ ...option, id: option.id || `option-${index}` })) };
      connections.push({ fromNodeId: textId, fromPort: "flowOut", toNodeId: choiceId, toPort: "flowIn" });
      options.forEach((option, index) => {
        if (option.next && source.nodes[option.next]) connections.push({ fromNodeId: choiceId, fromPort: `option${index}`, toNodeId: `text:${option.next}`, toPort: "flowIn" });
      });
    } else if (node.next && source.nodes[node.next]) {
      connections.push({ fromNodeId: textId, fromPort: "flowOut", toNodeId: `text:${node.next}`, toPort: "flowIn" });
    }
  });
  return normalizeBlueprint({ nodes, startNodeId: "start", connections });
}

export function createEmptyBlueprint() {
  return { nodes: {
    start: { id: "start", type: "flowStart", x: 80, y: 80, inputs: {}, outputs: {} },
    __prerequisite__: { id: "__prerequisite__", type: "prerequisite", x: 80, y: 240, inputs: { condition: true }, outputs: {} },
    __activity_expiry__: { id: "__activity_expiry__", type: "activityExpiry", x: 80, y: 360, inputs: { expires: false, expiresAt: 0 }, outputs: {} },
  }, connections: [], startNodeId: "start" };
}

export default normalizeBlueprint;
