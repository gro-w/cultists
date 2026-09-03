import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

/**
 * ActivityValidator - Blueprint schema normalization and structural
 * validation for the generic Activity node set (plan §13 Phase 2).
 */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeBlueprint(raw) {
  const source = raw || {};
  const nodes = {};
  for (const [id, node] of Object.entries(source.nodes || {})) {
    nodes[id] = { ...clone(node), id: node?.id || id, inputs: { ...(node?.inputs || {}) } };
  }
  const connections = Array.isArray(source.connections) ? source.connections.map((connection) => ({ ...connection })) : [];
  const startNodeId = source.startNodeId || Object.values(nodes).find((node) => node.type === "flowStart")?.id || null;
  return { nodes, connections, startNodeId };
}

function flowPorts(direction, definition) {
  return (direction === "input" ? definition?.flowInputs : definition?.flowOutputs) || [];
}

export function validateBlueprint(raw) {
  const blueprint = normalizeBlueprint(raw);
  const errors = [];
  const entries = Object.entries(blueprint.nodes);

  const starts = entries.filter(([, node]) => node.type === "flowStart");
  if (starts.length !== 1) errors.push(`流程起始节点必须恰好有一个，当前为 ${starts.length} 个`);
  if (!blueprint.startNodeId || !blueprint.nodes[blueprint.startNodeId]) errors.push("缺少有效的流程起始节点");
  if (blueprint.startNodeId && blueprint.nodes[blueprint.startNodeId]?.type !== "flowStart") errors.push("流程起点必须是起始节点");

  const ends = entries.filter(([, node]) => node.type === "activityEnd");
  if (!ends.length) errors.push("流程必须至少有一个活动结束节点");

  for (const [id, node] of entries) {
    if (node.id !== id) errors.push(`节点键 ${id} 与节点 id ${node.id} 不一致`);
    const definition = getActivityNodeDefinition(node.type);
    if (!definition) { errors.push(`节点 ${id} 使用未知类型 ${node.type}`); continue; }
    if (node.type !== "activityEnd") {
      for (const port of flowPorts("output", definition)) {
        const hasConnection = blueprint.connections.some((connection) => connection.fromNodeId === id && connection.fromPort === port.name);
        if (!hasConnection) errors.push(`节点 ${id} 的流程输出 ${port.name} 未连接`);
      }
    }
  }

  blueprint.connections.forEach((connection, index) => {
    const from = blueprint.nodes[connection.fromNodeId];
    const to = blueprint.nodes[connection.toNodeId];
    if (!from || !to) { errors.push(`连接 ${index} 引用了不存在的节点`); return; }
    const fromDef = getActivityNodeDefinition(from.type);
    const toDef = getActivityNodeDefinition(to.type);
    const sourcePort = (fromDef?.flowOutputs || []).find((port) => port.name === connection.fromPort);
    const targetPort = (toDef?.flowInputs || []).find((port) => port.name === connection.toPort);
    if (!sourcePort) errors.push(`连接 ${index} 的输出引脚不存在`);
    if (!targetPort) errors.push(`连接 ${index} 的输入引脚不存在`);
  });

  const reachable = new Set();
  const pending = blueprint.startNodeId ? [blueprint.startNodeId] : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    blueprint.connections.forEach((connection) => {
      if (connection.fromNodeId === id) pending.push(connection.toNodeId);
    });
  }
  entries.forEach(([id, node]) => {
    if (isReachabilityRequired(node.type) && !reachable.has(id)) errors.push(`流程节点 ${id} 不可从流程起始到达`);
  });

  return { ok: errors.length === 0, errors, blueprint };
}

function isReachabilityRequired(type) {
  const definition = getActivityNodeDefinition(type);
  return Boolean(definition && (definition.flowInputs?.length || definition.flowOutputs?.length));
}

export default normalizeBlueprint;
