// DEV-TOOLS:START
import { normalizeBlueprint, validateBlueprint } from "../core/ActivityValidator.js";
import { getActivityNodeDefinition, findFlowPort, arePortsCompatible } from "../core/ActivityNodeRegistry.js";

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

  /** Attempt a flow connection; rejects incompatible/unknown ports instead of throwing, per §6.3. */
  function connect(fromNodeId, fromPort, toNodeId, toPort) {
    const fromNode = current.nodes[fromNodeId];
    const toNode = current.nodes[toNodeId];
    if (!fromNode || !toNode) return { ok: false, error: "未知节点" };
    const sourcePort = findFlowPort(fromNode.type, "output", fromPort);
    const targetPort = findFlowPort(toNode.type, "input", toPort);
    if (!sourcePort) return { ok: false, error: `节点 ${fromNodeId} 没有输出端口 ${fromPort}` };
    if (!targetPort) return { ok: false, error: `节点 ${toNodeId} 没有输入端口 ${toPort}` };
    if (!arePortsCompatible(sourcePort, targetPort)) return { ok: false, error: "端口类型不兼容" };
    pushHistory();
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
