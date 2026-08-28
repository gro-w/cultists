import { getScheduleNodeDefinition, getScheduleNodePort, isFlowNode, isValueNode } from "./ScheduleNodeRegistry.js";

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
  const starts = entries.filter(([, node]) => node.type === "flowStart");
  if (starts.length !== 1) errors.push(`流程起始节点必须恰好有一个，当前为 ${starts.length} 个`);
  if (!blueprint.startNodeId || !blueprint.nodes[blueprint.startNodeId]) errors.push("缺少有效的流程起始节点");

  for (const [id, node] of entries) {
    if (!getScheduleNodeDefinition(node.type)) errors.push(`节点 ${id} 使用未知类型 ${node.type}`);
    const hasFlowOutput = Boolean(getScheduleNodeDefinition(node.type)?.flowOutputs?.length);
    const hasValueOutput = Boolean(getScheduleNodeDefinition(node.type)?.valueOutputs?.length);
    if (hasFlowOutput && hasValueOutput) errors.push(`节点 ${id} 不能同时拥有流程输出和数值输出`);
    if (node.id !== id) errors.push(`节点键 ${id} 与节点 id ${node.id} 不一致`);
  }

  const reachable = new Set();
  const pending = blueprint.startNodeId ? [blueprint.startNodeId] : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const connection of blueprint.connections) {
      if (connection.fromNodeId === id && portKind(getScheduleNodePort(blueprint.nodes[id]?.type, connection.fromPort, "output")) === "flow") {
        pending.push(connection.toNodeId);
      }
    }
    const node = blueprint.nodes[id];
    if (node?.next && blueprint.nodes[node.next]) pending.push(node.next);
    for (const option of node?.options || []) if (option.next && blueprint.nodes[option.next]) pending.push(option.next);
  }
  entries.forEach(([id, node]) => {
    if (isFlowNode(node.type) && !reachable.has(id)) errors.push(`流程节点 ${id} 不可从流程起始到达`);
  });

  blueprint.connections.forEach((connection, index) => {
    const from = blueprint.nodes[connection.fromNodeId];
    const to = blueprint.nodes[connection.toNodeId];
    if (!from || !to) { errors.push(`连接 ${index} 引用了不存在的节点`); return; }
    const sourcePort = getScheduleNodePort(from.type, connection.fromPort, "output");
    const targetPort = getScheduleNodePort(to.type, connection.toPort, "input");
    if (!sourcePort) errors.push(`连接 ${index} 的输出引脚不存在`);
    if (!targetPort) errors.push(`连接 ${index} 的输入引脚不存在`);
    if (sourcePort && targetPort && (portKind(sourcePort) !== portKind(targetPort) || (portKind(sourcePort) !== "flow" && targetPort.type !== "any" && sourcePort.type !== "any" && sourcePort.type !== targetPort.type))) {
      errors.push(`连接 ${index} 的引脚类型不匹配`);
    }
  });
  return { ok: errors.length === 0, errors, blueprint };
}

export function migrateDialogueTree(tree) {
  const source = clone(tree) || {};
  const nodes = { start: { id: "start", type: "flowStart", inputs: {}, outputs: {} } };
  const connections = [];
  Object.entries(source.nodes || {}).forEach(([id, node]) => {
    const textId = `text:${id}`;
    nodes[textId] = { ...node, id: textId, type: "text", inputs: { speaker: node.speaker || "npc", text: node.text || "" }, outputs: {} };
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
  return { nodes: { start: { id: "start", type: "flowStart", x: 80, y: 80, inputs: {}, outputs: {} } }, connections: [], startNodeId: "start" };
}

export default normalizeBlueprint;
