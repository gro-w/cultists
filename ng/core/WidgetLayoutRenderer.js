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

import { resolvePropertyValue } from "./PropertyBinding.js";

const CONTAINER_FLOWS = new Set(["vertical", "horizontal", "grid", "stack"]);

/** Reads a possibly-bound widget property (plan §7.5-equivalent value binding); falls back to the literal when unbound. */
function prop(node, key, ctx, fallback) {
  return resolvePropertyValue(node[key], { valueGraph: ctx.valueGraph, variableStore: ctx.variableStore }, fallback);
}

/** Apply container layout (flow/gap/padding/align/justify/wrap/minSize/maxSize) as inline CSS. */
function applyContainerStyle(el, node) {
  const flow = CONTAINER_FLOWS.has(node.flow) ? node.flow : "vertical";
  el.dataset.flow = flow;
  if (flow === "grid") {
    el.style.display = "grid";
  } else if (flow === "stack") {
    // "stack" is the one flow whose children have real, editable x/y
    // geometry (plan §7.3 "拖动窗口/组件到哪里就保存到哪里" for free
    // placement, as opposed to vertical/horizontal/grid where "对 flex/
    // grid 容器明确显示哪些 x/y 属性不生效"): children are positioned
    // absolutely within this container, exactly like a blueprint node on
    // its canvas.
    el.style.position = "relative";
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

/** In a "stack" container, position a child absolutely at its own x/y (each may be a plain literal or blueprint-bound value, per plan §7.5-equivalent binding; defaults to 0,0); a no-op for every other flow. */
function applyStackPosition(childEl, childNode, parentNode, ctx) {
  if (!parentNode || parentNode.type !== "container" || parentNode.flow !== "stack") return;
  childEl.style.position = "absolute";
  const x = Number(prop(childNode, "x", ctx, 0));
  const y = Number(prop(childNode, "y", ctx, 0));
  childEl.style.left = `${Number.isFinite(x) ? x : 0}px`;
  childEl.style.top = `${Number.isFinite(y) ? y : 0}px`;
}

/** Resolves the "enabled" property (literal or blueprint-bound) and, for controls with a real DOM `disabled` flag, applies it there too - not just as a decorative aria-disabled on the wrapper. */
function applyEnabled(el, node, ctx, controlEl) {
  const enabled = prop(node, "enabled", ctx, true) !== false;
  if (!enabled) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
  const target = controlEl || el;
  if ("disabled" in target) target.disabled = !enabled;
}

function applyCommonAttrs(el, node, ctx) {
  el.dataset.widgetId = node.widgetId || node.id || "";
  el.dataset.widgetType = node.type;
  if (node.className) el.className = `ng-widget ${node.className}`;
  else el.className = "ng-widget";
  el.classList.add(`ng-widget-${node.type}`);
  if (prop(node, "visible", ctx, true) === false) el.hidden = true;
  applyEnabled(el, node, ctx, ctx.controlEls?.get(node.widgetId || node.id));
}

function bindFocusBlur(el, node, ctx) {
  if (!ctx.onEvent) return;
  el.addEventListener("focus", () => ctx.onEvent(node, "onFocus"));
  el.addEventListener("blur", () => ctx.onEvent(node, "onBlur"));
}

function renderLeaf(node, ctx) {
  const el = document.createElement(node.type === "button" ? "button" : "div");
  switch (node.type) {
    case "label":
      el.textContent = prop(node, "text", ctx, "");
      break;
    case "button":
      el.type = "button";
      el.textContent = prop(node, "text", ctx, "");
      if (ctx.onEvent) el.addEventListener("click", () => ctx.onEvent(node, "onClick"));
      break;
    case "textInput": {
      const input = document.createElement("input");
      input.type = "text";
      input.value = prop(node, "value", ctx, "");
      if (ctx.onEvent) input.addEventListener("input", () => ctx.onEvent(node, "onChange", input.value));
      bindFocusBlur(input, node, ctx);
      el.appendChild(input);
      ctx.controlEls?.set(node.widgetId || node.id, input);
      break;
    }
    case "textarea": {
      const textarea = document.createElement("textarea");
      textarea.value = prop(node, "value", ctx, "");
      if (ctx.onEvent) textarea.addEventListener("input", () => ctx.onEvent(node, "onChange", textarea.value));
      bindFocusBlur(textarea, node, ctx);
      el.appendChild(textarea);
      ctx.controlEls?.set(node.widgetId || node.id, textarea);
      break;
    }
    case "select": {
      const select = document.createElement("select");
      // `options` may be a literal `[{value,label}]` array or a bound
      // value (plan-consistent with every other property) pulling a
      // `findRecords`-populated variableStore array of raw database
      // records - e.g. `{ "variable": "diagnosisOptions" }` set by the
      // window's `onCreate` blueprint. Records rarely have literal
      // `value`/`label` fields, so `optionValueField`/`optionLabelField`
      // (default `"id"`/`"name"`) name which record fields to read
      // instead - no mapping/loop node needed in the blueprint system.
      const valueField = node.optionValueField || "value";
      const labelField = node.optionLabelField || "label";
      for (const option of prop(node, "options", ctx, []) || []) {
        const opt = document.createElement("option");
        opt.value = option.value ?? option[valueField] ?? option.id ?? "";
        opt.textContent = option.label ?? option[labelField] ?? option.name ?? opt.value;
        select.appendChild(opt);
      }
      select.value = prop(node, "value", ctx, "");
      if (ctx.onEvent) select.addEventListener("change", () => ctx.onEvent(node, "onChange", select.value));
      bindFocusBlur(select, node, ctx);
      el.appendChild(select);
      ctx.controlEls?.set(node.widgetId || node.id, select);
      break;
    }
    case "checkbox": {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(prop(node, "value", ctx, false));
      if (ctx.onEvent) checkbox.addEventListener("change", () => ctx.onEvent(node, "onChange", checkbox.checked));
      el.appendChild(checkbox);
      ctx.controlEls?.set(node.widgetId || node.id, checkbox);
      break;
    }
    case "image": {
      const img = document.createElement("img");
      img.src = prop(node, "src", ctx, "") || "";
      img.alt = prop(node, "alt", ctx, "") || "";
      el.appendChild(img);
      break;
    }
    case "list": {
      // `items` may likewise be a bound array of raw database records
      // (e.g. a `findRecords` result written to variableStore by the
      // window's onCreate blueprint), so a list can render real rows with
      // no window-specific engine code. `itemLabelField` (default `"name"`)
      // names which record field to display when an item isn't already a
      // plain string or `{label}` literal. Clicking an item with an `id`
      // forwards `onItemClick` with that id as the widget event's
      // `event:value` (same convention every other widget event already
      // uses), so a blueprint can read which row was clicked without any
      // new node type.
      const itemLabelField = node.itemLabelField || "name";
      for (const item of prop(node, "items", ctx, []) || []) {
        const li = document.createElement("div");
        li.className = node.itemClassName ? `ng-widget-list-item ${node.itemClassName}` : "ng-widget-list-item";
        li.textContent = typeof item === "string" ? item : item.label ?? item[itemLabelField] ?? "";
        if (item && typeof item === "object" && item.id !== undefined) {
          li.dataset.itemId = item.id;
          if (ctx.onEvent) li.addEventListener("click", () => ctx.onEvent(node, "onItemClick", item.id));
        }
        el.appendChild(li);
      }
      break;
    }
    case "table": {
      const table = document.createElement("table");
      for (const row of prop(node, "rows", ctx, []) || []) {
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
      bar.style.width = `${Math.max(0, Math.min(100, Number(prop(node, "value", ctx, 0)) || 0))}%`;
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
  ctx.controlEls = ctx.controlEls || new Map();
  let el;
  if (node.type === "container") {
    el = document.createElement("div");
    applyContainerStyle(el, node);
    for (const child of node.children || []) {
      const childEl = renderWidgetNode(child, ctx);
      applyStackPosition(childEl, child, node, ctx);
      el.appendChild(childEl);
    }
  } else {
    el = renderLeaf(node, ctx);
  }
  applyCommonAttrs(el, node, ctx);
  ctx.widgetEls.set(node.widgetId || node.id, el);
  return el;
}

/** Render a whole window's `root` widget tree; returns { el, widgetEls }. */
export function renderWindowRoot(root, ctx = {}) {
  ctx.widgetEls = new Map();
  ctx.controlEls = new Map();
  const el = renderWidgetNode(root, ctx);
  return { el, widgetEls: ctx.widgetEls };
}

export default renderWindowRoot;
