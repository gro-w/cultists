/**
 * WidgetLayoutRenderer - the single DOM renderer for a window's widget
 * tree, shared verbatim between the runtime WindowFrame and the WYSIWYG
 * editor canvas (plan §7.1 "运行时和编辑器必须消费同一个 layout contract.
 * 不能让编辑器用绝对定位预览、运行时再包成 flex/grid，导致 WYSIWYG 虚假一致").
 *
 * Every widget node renders to exactly one element carrying
 * `data-widget-id` and `data-widget-type`, so both the editor (selection,
 * drag, inspector) and the runtime (event binding) can locate widgets by id
 * without maintaining a second parallel tree.
 */

const CONTAINER_FLOWS = new Set(["vertical", "horizontal", "grid", "stack"]);

/** Apply container layout (flow/gap/padding/align/justify/wrap/minSize/maxSize) as inline CSS. */
function applyContainerStyle(el, node) {
  const flow = CONTAINER_FLOWS.has(node.flow) ? node.flow : "vertical";
  el.dataset.flow = flow;
  if (flow === "grid") {
    el.style.display = "grid";
  } else if (flow === "stack") {
    el.style.display = "grid";
    el.style.gridTemplateAreas = '"stack"';
  } else {
    el.style.display = "flex";
    el.style.flexDirection = flow === "horizontal" ? "row" : "column";
  }
  if (node.wrap) el.style.flexWrap = "wrap";
  if (Number.isFinite(node.gap)) el.style.gap = `${node.gap}px`;
  if (Number.isFinite(node.padding)) el.style.padding = `${node.padding}px`;
  if (node.align) el.style.alignItems = node.align;
  if (node.justify) el.style.justifyContent = node.justify;
  if (node.minSize) {
    if (node.minSize.width != null) el.style.minWidth = `${node.minSize.width}px`;
    if (node.minSize.height != null) el.style.minHeight = `${node.minSize.height}px`;
  }
  if (node.maxSize) {
    if (node.maxSize.width != null) el.style.maxWidth = `${node.maxSize.width}px`;
    if (node.maxSize.height != null) el.style.maxHeight = `${node.maxSize.height}px`;
  }
}

function applyCommonAttrs(el, node) {
  el.dataset.widgetId = node.widgetId || node.id || "";
  el.dataset.widgetType = node.type;
  if (node.className) el.className = `ng-widget ${node.className}`;
  else el.className = "ng-widget";
  el.classList.add(`ng-widget-${node.type}`);
  if (node.visible === false) el.hidden = true;
  if (node.enabled === false) el.setAttribute("aria-disabled", "true");
}

function renderLeaf(node, ctx) {
  const el = document.createElement(node.type === "button" ? "button" : "div");
  switch (node.type) {
    case "label":
      el.textContent = node.text ?? "";
      break;
    case "button":
      el.type = "button";
      el.textContent = node.text ?? "";
      if (ctx.onEvent) el.addEventListener("click", () => ctx.onEvent(node, "onClick"));
      break;
    case "textInput": {
      const input = document.createElement("input");
      input.type = "text";
      input.value = node.value ?? "";
      if (ctx.onEvent) input.addEventListener("input", () => ctx.onEvent(node, "onChange", input.value));
      el.appendChild(input);
      break;
    }
    case "textarea": {
      const textarea = document.createElement("textarea");
      textarea.value = node.value ?? "";
      if (ctx.onEvent) textarea.addEventListener("input", () => ctx.onEvent(node, "onChange", textarea.value));
      el.appendChild(textarea);
      break;
    }
    case "select": {
      const select = document.createElement("select");
      for (const option of node.options || []) {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label ?? option.value;
        select.appendChild(opt);
      }
      select.value = node.value ?? "";
      if (ctx.onEvent) select.addEventListener("change", () => ctx.onEvent(node, "onChange", select.value));
      el.appendChild(select);
      break;
    }
    case "checkbox": {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(node.value);
      if (ctx.onEvent) checkbox.addEventListener("change", () => ctx.onEvent(node, "onChange", checkbox.checked));
      el.appendChild(checkbox);
      break;
    }
    case "image": {
      const img = document.createElement("img");
      img.src = node.src || "";
      img.alt = node.alt || "";
      el.appendChild(img);
      break;
    }
    case "list": {
      for (const item of node.items || []) {
        const li = document.createElement("div");
        li.className = "ng-widget-list-item";
        li.textContent = typeof item === "string" ? item : item.label ?? "";
        el.appendChild(li);
      }
      break;
    }
    case "table": {
      const table = document.createElement("table");
      for (const row of node.rows || []) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      el.appendChild(table);
      break;
    }
    case "progress": {
      const bar = document.createElement("div");
      bar.className = "ng-widget-progress-bar";
      bar.style.width = `${Math.max(0, Math.min(100, Number(node.value) || 0))}%`;
      el.appendChild(bar);
      break;
    }
    case "spacer":
      break;
    default:
      throw new Error(`Unknown widget type: ${node.type}`);
  }
  return el;
}

/**
 * Render a widget tree node (and its descendants) into a real DOM element.
 * Returns the root element; populates `ctx.widgetEls` (Map widgetId->el) as
 * a side effect so callers can look up any node's rendered element.
 */
export function renderWidgetNode(node, ctx = {}) {
  if (!node) throw new Error("renderWidgetNode requires a node");
  ctx.widgetEls = ctx.widgetEls || new Map();
  let el;
  if (node.type === "container") {
    el = document.createElement("div");
    applyContainerStyle(el, node);
    for (const child of node.children || []) {
      el.appendChild(renderWidgetNode(child, ctx));
    }
  } else {
    el = renderLeaf(node, ctx);
  }
  applyCommonAttrs(el, node);
  ctx.widgetEls.set(node.widgetId || node.id, el);
  return el;
}

/** Render a whole window's `root` widget tree; returns { el, widgetEls }. */
export function renderWindowRoot(root, ctx = {}) {
  ctx.widgetEls = new Map();
  const el = renderWidgetNode(root, ctx);
  return { el, widgetEls: ctx.widgetEls };
}

export default renderWindowRoot;
