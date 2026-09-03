import { getActivityNodeDefinition, getActivityNodePort, arePortsCompatible } from "./ActivityNodeRegistry.js";

/**
 * ActivityValidator - Blueprint schema normalization and structural
 * validation for the generic Activity node set (plan §13 Phase 2, §6.3
 * editor save-time rules).
 *
 * Schema (plan item "蓝图是一个流程只记录下家的链表，数值是只记录上家的链表"):
 * there is no flat top-level `connections` array. Each node instead carries
 *   - `next[outputPortName] = { nodeId, port }` for its flow outputs - a
 *     flow output can only ever point at ONE downstream node/port, exactly
 *     like a singly-linked list's `next` pointer (a flow *input* can still
 *     be targeted by any number of upstream `next` entries, since nothing
 *     stops several nodes from linking to the same input).
 *   - `inputs[valuePortName] = { nodeId, port }` for a value input wired to
 *     an upstream value output - a value input can only ever have ONE
 *     upstream source, again exactly one link in a singly-linked list (a
 *     value *output* can still be read by any number of downstream inputs).
 * `inputs[name]` may otherwise hold a plain literal or the legacy
 * `{ variable: name }` global-variable-read shorthand.
 */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isWireRef(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "nodeId" in value);
}

export function normalizeBlueprint(raw) {
  const source = raw || {};
  const nodes = {};
  for (const [id, node] of Object.entries(source.nodes || {})) {
    nodes[id] = { ...clone(node), id: node?.id || id, inputs: { ...(node?.inputs || {}) }, next: { ...(node?.next || {}) } };
  }
  // Back-compat: fold a legacy flat `connections` array (fromNodeId/
  // fromPort/toNodeId/toPort) into the next/inputs-only shape on load, so
  // any blueprint authored before this schema change still loads. Nothing
  // is ever written back out in the old shape.
  for (const connection of Array.isArray(source.connections) ? source.connections : []) {
    const fromNode = nodes[connection.fromNodeId];
    const toNode = nodes[connection.toNodeId];
    if (!fromNode || !toNode) continue;
    const sourcePort = getActivityNodePort(fromNode.type, "output", connection.fromPort);
    if (sourcePort?.kind === "flow") {
      fromNode.next[connection.fromPort] = { nodeId: connection.toNodeId, port: connection.toPort };
    } else {
      toNode.inputs[connection.toPort] = { nodeId: connection.fromNodeId, port: connection.fromPort };
    }
  }
  const startNodeId = source.startNodeId || Object.values(nodes).find((node) => node.type === "flowStart")?.id || null;
  return { nodes, startNodeId };
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
        const target = node.next?.[port.name];
        if (!target?.nodeId) { errors.push(`节点 ${id} 的流程输出 ${port.name} 未连接`); continue; }
        const targetNode = blueprint.nodes[target.nodeId];
        const targetPort = targetNode ? getActivityNodePort(targetNode.type, "input", target.port) : null;
        if (!targetNode) errors.push(`节点 ${id} 的流程输出 ${port.name} 指向不存在的节点`);
        else if (!targetPort) errors.push(`节点 ${id} 的流程输出 ${port.name} 指向的输入引脚不存在`);
        else if (!arePortsCompatible(port, targetPort)) errors.push(`节点 ${id} 的流程输出 ${port.name} 端口类型不兼容`);
      }
    }

    for (const [inputName, rawInput] of Object.entries(node.inputs || {})) {
      if (!isWireRef(rawInput)) continue;
      const sourceNode = blueprint.nodes[rawInput.nodeId];
      const sourcePort = sourceNode ? getActivityNodePort(sourceNode.type, "output", rawInput.port) : null;
      const targetPort = getActivityNodePort(node.type, "input", inputName);
      if (!sourceNode || !sourcePort) { errors.push(`节点 ${id} 的输入 ${inputName} 引用了不存在的数值输出`); continue; }
      if (sourcePort.kind !== "value" || targetPort?.kind !== "value") { errors.push(`节点 ${id} 的输入 ${inputName} 只能连接数值输出`); continue; }
      if (!arePortsCompatible(sourcePort, targetPort)) errors.push(`节点 ${id} 的输入 ${inputName} 端口类型不兼容`);
    }
  }

  const reachable = new Set();
  const pending = blueprint.startNodeId ? [blueprint.startNodeId] : [];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    // Only flow `next` links advance flow-reachability; a value-port wire
    // (e.g. an `arithmetic` node feeding a `branch`'s condition) never makes
    // the arithmetic node itself part of the flow graph. Nodes revisited via
    // a cycle (the loop replacement pattern) are simply skipped by the
    // `reachable.has(id)` guard above, so cycles terminate this walk fine.
    for (const target of Object.values(blueprint.nodes[id]?.next || {})) {
      if (target?.nodeId) pending.push(target.nodeId);
    }
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
