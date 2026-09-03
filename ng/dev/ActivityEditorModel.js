// DEV-TOOLS:START
import { normalizeBlueprint, validateBlueprint } from "../core/ActivityValidator.js";
import { getActivityNodeDefinition, getActivityNodePort, arePortsCompatible } from "../core/ActivityNodeRegistry.js";

/**
 * ActivityEditorModel - DOM-independent state for one Activity editor
 * window (plan §6.2). Every window constructs its own model instance (no
 * module-level singleton), so two editor windows never share selection,
 * history or draft mutations even if they happen to be editing the same
 * source activity id (probe: "两个 Activity 编辑器窗口互不串状态").
 *
 * The only canonical model this editor saves is the Blueprint itself
 * (plan §6.2 "编辑器保存的唯一 canonical model 是 blueprint"): node
 * positions (`x`/`y`) are stored directly on each node record so
 * export/reload round-trips positions without a parallel "layout" object.
 */

const HISTORY_LIMIT = 50;

let _nodeSeq = 0;
let _connectionSeq = 0;

function cloneBlueprint(blueprint) {
  return JSON.parse(JSON.stringify(blueprint));
}

export function createActivityEditorModel({ activityId, blueprint, displayName } = {}) {
  let current = normalizeBlueprint(blueprint || {});
  let name = displayName || activityId || "untitled";
  const selection = new Set();
  const history = [];
  const future = [];

  function pushHistory() {
    history.push(cloneBlueprint(current));
    if (history.length > HISTORY_LIMIT) history.shift();
    future.length = 0;
  }

  function nodeDefinitions(id) {
    const node = current.nodes[id];
    return node ? getActivityNodeDefinition(node.type) : null;
  }

  function addNode(type, x = 0, y = 0, inputs = {}) {
    const definition = getActivityNodeDefinition(type);
    if (!definition) throw new Error(`Unknown node type: ${type}`);
    pushHistory();
    const id = `${type}-${++_nodeSeq}`;
    const node = { id, type, x, y, inputs: { ...inputs } };
    current.nodes[id] = node;
    if (type === "flowStart" && !current.startNodeId) current.startNodeId = id;
    return node;
  }

  function moveNode(id, x, y) {
    const node = current.nodes[id];
    if (!node) return false;
    node.x = x;
    node.y = y;
    return true;
  }

  /** Move every currently selected node by the same delta (multi-drag, §6.2). */
  function moveSelected(dx, dy) {
    let moved = false;
    for (const id of selection) {
      const node = current.nodes[id];
      if (!node) continue;
      node.x += dx;
      node.y += dy;
      moved = true;
    }
    return moved;
  }

  function beginDrag() {
    pushHistory();
  }

  function deleteNode(id) {
    if (!current.nodes[id]) return false;
    pushHistory();
    delete current.nodes[id];
    current.connections = current.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id);
    selection.delete(id);
    if (current.startNodeId === id) current.startNodeId = null;
    return true;
  }

  function selectOnly(id) {
    selection.clear();
    if (id) selection.add(id);
  }

  function toggleSelect(id) {
    if (!id) return;
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }

  function clearSelection() {
    selection.clear();
  }

  /** Box-select every node whose position falls within `rect` ({x,y,width,height} in logical/unscaled canvas coordinates). */
  function selectInBox(rect, { additive = false } = {}) {
    if (!additive) selection.clear();
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;
    for (const node of Object.values(current.nodes)) {
      if (node.x >= rect.x && node.x <= x2 && node.y >= rect.y && node.y <= y2) selection.add(node.id);
    }
    return [...selection];
  }

  function getSelection() {
    return [...selection];
  }

  function isSelected(id) {
    return selection.has(id);
  }

  /** Attempt a connection (flow or value); rejects incompatible/unknown ports instead of throwing, per §6.3. Rewiring a target input replaces any existing wire into that same port, since an input port can only be fed by one source at a time. */
  function connect(fromNodeId, fromPort, toNodeId, toPort) {
    const fromNode = current.nodes[fromNodeId];
    const toNode = current.nodes[toNodeId];
    if (!fromNode || !toNode) return { ok: false, error: "未知节点" };
    const sourcePort = getActivityNodePort(fromNode.type, "output", fromPort);
    const targetPort = getActivityNodePort(toNode.type, "input", toPort);
    if (!sourcePort) return { ok: false, error: `节点 ${fromNodeId} 没有输出端口 ${fromPort}` };
    if (!targetPort) return { ok: false, error: `节点 ${toNodeId} 没有输入端口 ${toPort}` };
    if (!arePortsCompatible(sourcePort, targetPort)) return { ok: false, error: "端口类型不兼容" };
    pushHistory();
    current.connections = current.connections.filter((c) => !(c.toNodeId === toNodeId && c.toPort === toPort));
    if (targetPort.kind === "value" && toNode.inputs) delete toNode.inputs[toPort];
    const id = `edge-${++_connectionSeq}`;
    current.connections.push({ id, fromNodeId, fromPort, toNodeId, toPort });
    return { ok: true, id };
  }

  function disconnect(connectionId) {
    const before = current.connections.length;
    pushHistory();
    current.connections = current.connections.filter((c) => c.id !== connectionId);
    return current.connections.length !== before;
  }

  /**
   * Layered/barycenter auto-layout ("自动排布"), ported from the legacy
   * engine's DevDialogueEditorTab._autoLayout(). Purely graph-generic: it
   * only reads `current.connections`/`current.nodes` and writes `x`/`y`, so
   * it carries no domain-specific logic and works for any node types.
   */
  function autoLayout() {
    const ids = Object.keys(current.nodes);
    if (!ids.length) return false;
    pushHistory();
    const W = 200, H = 120, GAPX = 100, GAPY = 45, PAD = 40;
    const orderIndex = new Map(ids.map((id, index) => [id, index]));
    const outgoing = new Map(ids.map((id) => [id, new Set()]));
    const incoming = new Map(ids.map((id) => [id, new Set()]));
    for (const connection of current.connections) {
      const { fromNodeId, toNodeId } = connection;
      if (!outgoing.has(fromNodeId) || !incoming.has(toNodeId) || fromNodeId === toNodeId) continue;
      outgoing.get(fromNodeId).add(toNodeId);
      incoming.get(toNodeId).add(fromNodeId);
    }

    // Topological ranking (Kahn's algorithm): rank = longest path from any root.
    const indegree = new Map(ids.map((id) => [id, incoming.get(id).size]));
    const ranks = new Map(ids.map((id) => [id, 0]));
    const queue = ids.filter((id) => indegree.get(id) === 0);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      for (const target of outgoing.get(id)) {
        ranks.set(target, Math.max(ranks.get(target), ranks.get(id) + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    // Any nodes left with indegree > 0 (a cycle) still have a rank from the
    // relaxation above; they just never got pushed onto `queue`, which is
    // fine since we only need `ranks` from here on.
    const maxRank = Math.max(0, ...ranks.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    for (const id of ids) layers[ranks.get(id)].push(id);

    // 4-pass median/barycenter crossing-reduction sweep.
    const positionMap = () => {
      const map = new Map();
      layers.forEach((layer) => layer.forEach((id, index) => map.set(id, index)));
      return map;
    };
    const median = (values) => (values.length ? values[Math.floor((values.length - 1) / 2)] : Number.POSITIVE_INFINITY);
    const reorder = (layerIndex, useParents) => {
      const layer = layers[layerIndex];
      const positions = positionMap();
      const neighborRank = useParents ? layerIndex - 1 : layerIndex + 1;
      const neighborsOf = useParents ? incoming : outgoing;
      layer.sort((left, right) => {
        const leftMedian = median([...neighborsOf.get(left)].filter((id) => ranks.get(id) === neighborRank).map((id) => positions.get(id)).sort((a, b) => a - b));
        const rightMedian = median([...neighborsOf.get(right)].filter((id) => ranks.get(id) === neighborRank).map((id) => positions.get(id)).sort((a, b) => a - b));
        return leftMedian - rightMedian || orderIndex.get(left) - orderIndex.get(right);
      });
    };
    for (let pass = 0; pass < 4; pass += 1) {
      for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) reorder(layerIndex, true);
      for (let layerIndex = layers.length - 2; layerIndex >= 0; layerIndex -= 1) reorder(layerIndex, false);
    }

    layers.forEach((layer, rank) => {
      layer.forEach((id, row) => {
        current.nodes[id].x = PAD + rank * (W + GAPX);
        current.nodes[id].y = PAD + row * (H + GAPY);
      });
    });
    return true;
  }

  function undo() {
    if (!history.length) return false;
    future.push(cloneBlueprint(current));
    current = history.pop();
    return true;
  }

  function redo() {
    if (!future.length) return false;
    history.push(cloneBlueprint(current));
    current = future.pop();
    return true;
  }

  /** Structural + port-compatibility validation (§6.3), independent of the runtime's own validateBlueprint. */
  function validateForSave() {
    return validateBlueprint(current);
  }

  /** The one canonical export: a plain blueprint object, including each node's presentation position. */
  function exportBlueprint() {
    return cloneBlueprint(current);
  }

  function loadBlueprint(nextBlueprint) {
    pushHistory();
    current = normalizeBlueprint(nextBlueprint);
    selection.clear();
  }

  function toDefinition() {
    return { id: activityId, displayName: name, blueprint: exportBlueprint() };
  }

  function toDownloadPayload() {
    return JSON.stringify(toDefinition(), null, 2);
  }

  function setDisplayName(nextName) {
    name = nextName;
  }

  return {
    activityId,
    get displayName() { return name; },
    setDisplayName,
    addNode,
    moveNode,
    moveSelected,
    beginDrag,
    deleteNode,
    selectOnly,
    toggleSelect,
    clearSelection,
    selectInBox,
    getSelection,
    isSelected,
    connect,
    disconnect,
    autoLayout,
    undo,
    redo,
    canUndo: () => history.length > 0,
    canRedo: () => future.length > 0,
    validateForSave,
    exportBlueprint,
    loadBlueprint,
    toDefinition,
    toDownloadPayload,
    nodeDefinitions,
    getNode: (id) => current.nodes[id] || null,
    listNodes: () => Object.values(current.nodes),
    listConnections: () => [...current.connections],
    get startNodeId() { return current.startNodeId; },
  };
}

export default createActivityEditorModel;
// DEV-TOOLS:END
