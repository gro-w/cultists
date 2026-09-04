// DEV-TOOLS:START
/**
 * WindowEditorModel - DOM-independent state for the custom window WYSIWYG
 * editor (plan §7). The only canonical model saved is the window
 * definition itself; a widget's position in the tree (parentId + index) is
 * the sole "layout" record, so export/reload round-trips both structure
 * and (for the widgets that expose them) explicit `x`/`y` fields.
 *
 * Every editor window constructs its own model instance (no module-level
 * singleton), matching ActivityEditorModel's isolation guarantee so two
 * window editor windows never share selection/history/drafts.
 */

let _widgetSeq = 0;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultWidget(type) {
  const widgetId = `${type}-${++_widgetSeq}`;
  const base = { widgetId, type };
  if (type === "container") return { ...base, flow: "vertical", gap: 4, padding: 4, children: [] };
  if (type === "label") return { ...base, text: "文本" };
  if (type === "button") return { ...base, text: "按钮" };
  if (type === "spacer") return base;
  return { ...base, value: "" };
}

function defaultRoot() {
  return { widgetId: "root", type: "container", flow: "vertical", gap: 8, padding: 10, children: [] };
}

export function createWindowEditorModel({ definition } = {}) {
  let current = cloneValue(definition) || {
    id: "untitled",
    title: "未命名窗口",
    mode: "window",
    fullscreen: false,
    geometry: { x: 80, y: 60, width: 480, height: 320 },
    root: defaultRoot(),
    events: { onCreate: null, onDestroy: null },
  };
  // A definition may legitimately have no `root` widget tree yet (legacy
  // `body`-only windows like example.json, or a dev-tool window registered
  // before the widget-tree schema). Synthesize an empty root rather than
  // letting every tree-walking helper below crash on `undefined`; this
  // never discards `body` since `toDefinition()` still carries it through.
  if (!current.root) current.root = defaultRoot();
  let selectedId = null;
  const history = [];
  const future = [];

  function pushHistory() {
    history.push(cloneValue(current));
    if (history.length > 50) history.shift();
    future.length = 0;
  }

  /** Depth-first walk; visitor receives (node, parent, index). */
  function walk(node, parent, index, visitor) {
    visitor(node, parent, index);
    if (node.type === "container") {
      (node.children || []).forEach((child, i) => walk(child, node, i, visitor));
    }
  }

  function findWidget(widgetId) {
    let found = null;
    walk(current.root, null, -1, (node, parent, index) => {
      if (found) return;
      if (node.widgetId === widgetId) found = { node, parent, index };
    });
    return found;
  }

  function listWidgets() {
    const list = [];
    walk(current.root, null, -1, (node) => list.push(node));
    return list;
  }

  function select(widgetId) {
    selectedId = widgetId;
  }

  function getSelected() {
    return selectedId ? findWidget(selectedId)?.node ?? null : null;
  }

  function addWidget(type, parentId = "root", index = null) {
    const parentEntry = findWidget(parentId);
    if (!parentEntry || parentEntry.node.type !== "container") return null;
    pushHistory();
    const widget = defaultWidget(type);
    const children = parentEntry.node.children || (parentEntry.node.children = []);
    const at = index == null ? children.length : Math.max(0, Math.min(children.length, index));
    children.splice(at, 0, widget);
    selectedId = widget.widgetId;
    return widget;
  }

  function removeWidget(widgetId) {
    if (widgetId === current.root.widgetId) return false;
    const entry = findWidget(widgetId);
    if (!entry || !entry.parent) return false;
    pushHistory();
    entry.parent.children.splice(entry.index, 1);
    if (selectedId === widgetId) selectedId = null;
    return true;
  }

  function duplicateWidget(widgetId) {
    const entry = findWidget(widgetId);
    if (!entry || !entry.parent) return null;
    pushHistory();
    const copy = cloneValue(entry.node);
    reassignIds(copy);
    entry.parent.children.splice(entry.index + 1, 0, copy);
    selectedId = copy.widgetId;
    return copy;
  }

  function reassignIds(node) {
    node.widgetId = `${node.type}-${++_widgetSeq}`;
    if (node.type === "container") (node.children || []).forEach(reassignIds);
  }

  /** Move a widget to a new parent container at a new index (used for both reorder-within-parent and reparent drag). */
  function moveWidget(widgetId, newParentId, newIndex) {
    if (widgetId === current.root.widgetId) return false;
    const entry = findWidget(widgetId);
    const target = findWidget(newParentId);
    if (!entry || !entry.parent || !target || target.node.type !== "container") return false;
    if (isDescendant(entry.node, target.node)) return false; // never move a container into its own subtree
    pushHistory();
    entry.parent.children.splice(entry.index, 1);
    const children = target.node.children || (target.node.children = []);
    const at = newIndex == null ? children.length : Math.max(0, Math.min(children.length, newIndex));
    children.splice(at, 0, entry.node);
    return true;
  }

  function isDescendant(maybeAncestor, node) {
    if (maybeAncestor === node) return true;
    if (maybeAncestor.type !== "container") return false;
    return (maybeAncestor.children || []).some((child) => isDescendant(child, node));
  }

  function updateWidgetProps(widgetId, patch) {
    const entry = findWidget(widgetId);
    if (!entry) return false;
    pushHistory();
    Object.assign(entry.node, patch);
    return true;
  }

  function updateWindowProps(patch) {
    pushHistory();
    Object.assign(current, patch);
    return true;
  }

  function undo() {
    if (!history.length) return false;
    future.push(cloneValue(current));
    current = history.pop();
    return true;
  }

  function redo() {
    if (!future.length) return false;
    history.push(cloneValue(current));
    current = future.pop();
    return true;
  }

  function toDefinition() {
    return cloneValue(current);
  }

  return {
    listWidgets,
    findWidget,
    select,
    getSelected,
    getSelectedId: () => selectedId,
    addWidget,
    removeWidget,
    duplicateWidget,
    moveWidget,
    updateWidgetProps,
    updateWindowProps,
    undo,
    redo,
    toDefinition,
    get definition() {
      return current;
    },
  };
}

export default createWindowEditorModel;
// DEV-TOOLS:END
