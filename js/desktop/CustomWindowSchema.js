// DEV-TOOLS:START
import { validateBlueprint } from "../core/ActivityBlueprint.js";
/** Schema and validation rules for developer-authored custom windows. */
export const CUSTOM_WIDGET_TYPES = Object.freeze({ label: "文字", button: "按钮", input: "文字输入", textarea: "多行输入", select: "下拉框", checkbox: "复选框", image: "图片", list: "列表", panel: "分组容器" });
const clone = (value) => JSON.parse(JSON.stringify(value));

export function createCustomEventBlueprint() {
  return { startNodeId: "start", nodes: {
    start: { id: "start", type: "flowStart", inputs: {}, outputs: {}, x: 80, y: 80 },
    end: { id: "end", type: "activityEnd", inputs: {}, outputs: {}, x: 320, y: 80 },
    __prerequisite__: { id: "__prerequisite__", type: "prerequisite", inputs: { condition: true }, outputs: {}, x: 80, y: 240 },
    __activity_expiry__: { id: "__activity_expiry__", type: "activityExpiry", inputs: { expires: false, expiresAt: 0 }, outputs: {}, x: 80, y: 360 },
  }, connections: [{ fromNodeId: "start", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" }] };
}

export function createCustomWindowDraft(id = "custom_app") {
  return { version: 1, id, title: "新窗口", icon: "🗔", width: 520, height: 360, background: "#d4d0c8", widgets: [], blueprints: {} };
}

export function validateCustomWindow(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const errors = [];
  const widgets = Array.isArray(value.widgets) ? value.widgets : [];
  const ids = new Set();
  if (!/^[a-z][a-z0-9_-]{1,48}$/.test(String(value.id || ""))) errors.push("窗口 id 必须是 2–49 位小写字母、数字、下划线或短横线");
  if (!String(value.title || "").trim()) errors.push("窗口标题不能为空");
  ["width", "height"].forEach((key) => { if (!Number.isFinite(Number(value[key])) || Number(value[key]) < (key === "width" ? 260 : 160)) errors.push(`${key} 尺寸无效`); });
  widgets.forEach((widget, index) => {
    if (!widget || typeof widget !== "object") return errors.push(`部件 ${index + 1} 不是对象`);
    if (!widget.id || ids.has(widget.id)) errors.push(`部件 id 重复或为空：${widget.id || index + 1}`);
    ids.add(widget.id);
    if (!CUSTOM_WIDGET_TYPES[widget.type]) errors.push(`部件 ${widget.id || index + 1} 类型无效`);
    ["x", "y", "width", "height"].forEach((key) => { if (!Number.isFinite(Number(widget[key]))) errors.push(`${widget.id} 的 ${key} 不是数字`); });
    ["onCreate", "onDestroy", "onClick", "onChange", "onSubmit", "onSelect"].forEach((event) => { if (widget[event] != null && typeof widget[event] !== "string") errors.push(`${widget.id} 的 ${event} 必须是蓝图 id`); });
  });
  ["onCreate", "onDestroy"].forEach((event) => { if (value[event] != null && typeof value[event] !== "string") errors.push(`窗口的 ${event} 必须是蓝图 id`); });
  const blueprints = value.blueprints && typeof value.blueprints === "object" ? value.blueprints : {};
  Object.entries(blueprints).forEach(([id, blueprint]) => {
    if (!blueprint || typeof blueprint !== "object") return errors.push(`蓝图 ${id} 不是对象`);
    const result = validateBlueprint(blueprint);
    if (!result.ok) result.errors.forEach((error) => errors.push(`蓝图 ${id}：${error}`));
  });
  return { ok: errors.length === 0, errors, value: clone({ ...value, widgets, blueprints }) };
}
// DEV-TOOLS:END
