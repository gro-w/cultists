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
import { evaluateCondition } from "./ConditionEvaluator.js";

const CONTAINER_FLOWS = new Set(["vertical", "horizontal", "grid", "stack"]);

/** Reads a possibly-bound widget property (plan §7.5-equivalent value binding); falls back to the literal when unbound. */
function prop(node, key, ctx, fallback) {
  return resolvePropertyValue(node[key], {
    valueGraph: ctx.valueGraph,
    variableStore: ctx.variableStore,
    pvGateway: ctx.pvGateway,
    dbGateway: ctx.dbGateway,
    runtimeGateway: ctx.runtimeGateway,
  }, fallback);
}

/** Apply container layout (flow/gap/padding/align/justify/wrap/minSize/maxSize) as inline CSS. */
function applyContainerStyle(el, node, ctx) {
  const flowValue = prop(node, "flow", ctx, "vertical");
  const flow = CONTAINER_FLOWS.has(flowValue) ? flowValue : "vertical";
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
  if (prop(node, "wrap", ctx, false)) el.style.flexWrap = "wrap";
  const gap = Number(prop(node, "gap", ctx, NaN));
  const padding = Number(prop(node, "padding", ctx, NaN));
  if (Number.isFinite(gap)) el.style.gap = `${gap}px`;
  if (Number.isFinite(padding)) el.style.padding = `${padding}px`;
  const align = prop(node, "align", ctx, "");
  const justify = prop(node, "justify", ctx, "");
  if (align) el.style.alignItems = align;
  if (justify) el.style.justifyContent = justify;
  const minSize = prop(node, "minSize", ctx, null);
  const maxSize = prop(node, "maxSize", ctx, null);
  if (minSize) {
    if (minSize.width != null) el.style.minWidth = `${minSize.width}px`;
    if (minSize.height != null) el.style.minHeight = `${minSize.height}px`;
  }
  if (maxSize) {
    if (maxSize.width != null) el.style.maxWidth = `${maxSize.width}px`;
    if (maxSize.height != null) el.style.maxHeight = `${maxSize.height}px`;
  }
}

/** In a "stack" container, position a child absolutely at its own x/y (each may be a plain literal or blueprint-bound value, per plan §7.5-equivalent binding; defaults to 0,0); a no-op for every other flow. */
function applyStackPosition(childEl, childNode, parentNode, ctx) {
  if (!parentNode || parentNode.type !== "container" || prop(parentNode, "flow", ctx, "vertical") !== "stack") return;
  childEl.style.position = "absolute";
  const x = Number(prop(childNode, "x", ctx, 0));
  const y = Number(prop(childNode, "y", ctx, 0));
  childEl.style.left = `${Number.isFinite(x) ? x : 0}px`;
  childEl.style.top = `${Number.isFinite(y) ? y : 0}px`;
}

/** Resolves the "enabled" property (literal or blueprint-bound) and, for controls with a real DOM `disabled` flag, applies it there too - not just as a decorative aria-disabled on the wrapper. */
function applyEnabled(el, node, ctx, controlEl) {
  // An explicitly bound null/undefined/empty value means the control is not
  // actionable. The old `!== false` check treated null as enabled, which
  // made buttons backed by an optional selection clickable before selection.
  const enabled = Boolean(prop(node, "enabled", ctx, true));
  if (!enabled) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
  const target = controlEl || el;
  if ("disabled" in target) target.disabled = !enabled;
}

function findRunActivityId(events) {
  if (!events || typeof events !== "object") return null;
  const pending = [events];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (value.type === "runActivity") return value.inputs?.activityId || null;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return null;
}

function applyCommonAttrs(el, node, ctx) {
  el.dataset.widgetId = node.widgetId || node.id || "";
  el.dataset.widgetType = node.type;
  const className = prop(node, "className", ctx, "");
  if (className) el.className = `ng-widget ${className}`;
  else el.className = "ng-widget";
  el.classList.add(`ng-widget-${node.type}`);
  if (evaluateCondition(node.activeWhen, ctx.conditionContext || {})) el.classList.add("active");
  const activityId = node.activityId || findRunActivityId(node.events);
  // An event blueprint may contain a bound activity id (for example HIS
  // reads the selected patient's dialogueActivityId). It is not an activity
  // definition id and must not be fed into the generic availability evaluator;
  // doing so hides the button before the event can start the activity.
  const implicitAvailability = typeof activityId === "string" && activityId
    ? { activity: { id: activityId, available: true } }
    : null;
  const visible = prop(node, "visible", ctx, true) !== false
    && evaluateCondition(node.visibleWhen || implicitAvailability, ctx.conditionContext || {});
  if (!visible) {
    el.hidden = true;
    // Container widgets set an inline display value (flex/grid) before this
    // common-attribute pass. That author rule overrides the browser's UA
    // `[hidden] { display: none }`, causing tab panels to stack visibly.
    el.style.setProperty("display", "none", "important");
  } else {
    el.hidden = false;
  }
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
    case "clock": {
      const snapshot = ctx.gameClock?.snapshot?.() || { day: 1, minutes: 0 };
      const hh = String(Math.floor(snapshot.minutes / 60)).padStart(2, "0");
      const mm = String(snapshot.minutes % 60).padStart(2, "0");
      el.textContent = node.format === "his"
        ? `第${snapshot.day}天 · ${snapshot.minutes >= 360 && snapshot.minutes < 1080 ? "白天" : "夜晚"} · ${hh}:${mm}`
        : `Day ${snapshot.day} ${hh}:${mm}`;
      break;
    }
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
      if (node.placeholder) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = node.placeholder;
        select.appendChild(placeholder);
      }
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
    case "range": {
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(prop(node, "min", ctx, 0));
      range.max = String(prop(node, "max", ctx, 100));
      range.step = String(prop(node, "step", ctx, 1));
      range.value = String(prop(node, "value", ctx, prop(node, "min", ctx, 0)));
      if (ctx.onEvent) range.addEventListener("input", () => ctx.onEvent(node, "onChange", range.value));
      bindFocusBlur(range, node, ctx);
      el.appendChild(range);
      ctx.controlEls?.set(node.widgetId || node.id, range);
      break;
    }
    case "image": {
      const img = document.createElement("img");
      img.src = prop(node, "src", ctx, "") || "";
      img.alt = prop(node, "alt", ctx, "") || "";
      el.appendChild(img);
      break;
    }
    case "dialogue": {
      const displayTo = prop(node, "displayTo", ctx, "dialogue");
      const view = ctx.dialogueViews?.[displayTo];
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] render dialogue widget", { widgetId: node.widgetId, displayTo, foundView: Boolean(view), connected: Boolean(view?.el?.isConnected) });
      /* DEV-TOOLS:END */
      if (view?.el) el.appendChild(view.el);
      break;
    }
    case "saveLoad": {
      const saveManager = ctx.saveManager;
      const status = document.createElement("p");
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "保存到文件";
      save.addEventListener("click", () => {
        try {
          const envelope = saveManager.snapshot();
          const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `cultists-ng-save-day${envelope.state.gameClock.day}.json`;
          link.click();
          URL.revokeObjectURL(url);
          status.textContent = "已保存到文件";
        } catch (error) { status.textContent = `保存失败：${error.message}`; }
      });
      const load = document.createElement("input");
      load.type = "file";
      load.accept = "application/json";
      load.addEventListener("change", () => {
        const file = load.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { saveManager.restore(JSON.parse(String(reader.result))); status.textContent = "已加载存档"; }
          catch (error) { status.textContent = `加载失败：${error.message}`; }
          load.value = "";
        };
        reader.readAsText(file);
      });
      el.append(save, load, status);
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
      const itemLabelTemplate = node.itemLabelTemplate || null;
      const itemClassField = node.itemClassField || null;
      const itemDisabledField = node.itemDisabledField || null;
      for (const item of prop(node, "items", ctx, []) || []) {
        const li = document.createElement(node.itemType === "button" ? "button" : "div");
        if (li.tagName === "BUTTON") li.type = "button";
        const itemClass = item && typeof item === "object" && item.className ? ` ${item.className}` : "";
        const dataClass = itemClassField && item && typeof item === "object" && item[itemClassField] ? ` ${item[itemClassField]}` : "";
        li.className = node.itemClassName ? `ng-widget-list-item ${node.itemClassName}${dataClass}${itemClass}` : `ng-widget-list-item${dataClass}${itemClass}`;
        if (itemDisabledField && item && typeof item === "object") li.disabled = Boolean(item[itemDisabledField]);
        li.textContent = typeof item === "string" ? item : itemLabelTemplate
          ? itemLabelTemplate.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => item?.[key] ?? "")
          : item.label ?? item[itemLabelField] ?? "";
        if (item && typeof item === "object" && item.id !== undefined) {
          li.dataset.itemId = item.id;
          if (ctx.onEvent) li.addEventListener("click", () => ctx.onEvent(node, "onItemClick", item.id));
          for (const action of node.itemActions || []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = action.className || "win95-btn bevel-out ng-list-item-action";
            button.textContent = action.label || action.id || "操作";
            button.addEventListener("click", (event) => {
              event.stopPropagation();
              ctx.onEvent?.(node, action.eventName || action.id, item.id);
            });
            li.appendChild(button);
          }
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
  if (node.type === "container" || node.type === "tabs") {
    el = document.createElement("div");
    applyContainerStyle(el, node, ctx);
    for (const child of node.children || []) {
      const childEl = renderWidgetNode(child, ctx);
      applyStackPosition(childEl, child, node, ctx);
      el.appendChild(childEl);
    }
    if (Array.isArray(node.componentActions) && node.componentActions.length) {
      const actions = new Set(node.componentActions);
      if (actions.has("add")) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "win95-btn bevel-out his-prescription-copy";
      add.textContent = "+";
      add.title = "添加药品行";
      add.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.onEvent?.(node, "onAdd");
      });
        el.append(add);
      }
      if (actions.has("remove")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "win95-btn bevel-out his-prescription-delete";
      remove.textContent = "−";
      remove.title = "删除药品行";
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ctx.onEvent?.(node, "onRemove");
      });
        el.append(remove);
      }
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
