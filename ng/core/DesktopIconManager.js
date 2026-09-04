/**
 * DesktopIconManager - plan §8.1/§8.2's icon layout + double-click routing
 * model. Every icon is a plain data record:
 *
 *   { iconId, label, glyph, order, position: {mode:"grid"} | {mode:"free", x, y},
 *     blueprintId, inputs }
 *
 * `blueprintId` is either one of `BUILTIN_ICON_BLUEPRINT_IDS` or a custom
 * Activity id already registered in the ActivityDefinitionStore; either
 * way the icon itself never references a windowId/activityId/consumeTime
 * call directly (plan §8.2 "双击只绑定一个稳定的 blueprint ID 和输入参数;
 * 不在图标数据中内联另一套执行器"). Resolving *which* blueprint that id
 * means is the caller's job (see engine.js's `runIconBlueprint`); this
 * class only owns the icon list itself - order, position and the
 * declared blueprint reference - so it can be unit-tested without a
 * running Activity engine.
 */
export class DesktopIconManager {
  constructor(icons = []) {
    this.icons = new Map();
    icons.forEach((icon, index) => this.register({ order: index, ...icon }));
  }

  register(icon) {
    if (!icon?.iconId) throw new Error("DesktopIconManager.register requires an iconId");
    if (!icon.blueprintId) throw new Error(`Icon "${icon.iconId}" must declare a blueprintId`);
    const position = icon.position && icon.position.mode ? icon.position : { mode: "grid" };
    this.icons.set(icon.iconId, {
      iconId: icon.iconId,
      label: icon.label || icon.iconId,
      glyph: icon.glyph || "🗂",
      order: Number.isFinite(icon.order) ? icon.order : this.icons.size,
      position,
      blueprintId: icon.blueprintId,
      inputs: icon.inputs || {},
    });
    return this.icons.get(icon.iconId);
  }

  get(iconId) {
    return this.icons.get(iconId) || null;
  }

  /** Icons in display order (stable sort keeps insertion order for equal `order` values). */
  list() {
    return [...this.icons.values()]
      .map((icon, index) => ({ icon, index }))
      .sort((a, b) => a.icon.order - b.icon.order || a.index - b.index)
      .map(({ icon }) => icon);
  }

  /** Moves an icon to a new grid order, shifting every other icon's order accordingly (plan §8.2 "拖动图标调整位置/选择图标顺序"). */
  reorder(iconId, newOrder) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.position = { mode: "grid" };
    const ordered = this.list().filter((entry) => entry.iconId !== iconId);
    const at = Math.max(0, Math.min(ordered.length, newOrder));
    ordered.splice(at, 0, icon);
    ordered.forEach((entry, index) => (entry.order = index));
    return true;
  }

  /** Switches an icon to free x/y placement (plan §8.1 "自由 x/y"). */
  setFreePosition(iconId, x, y) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.position = { mode: "free", x, y };
    return true;
  }

  setLogo(iconId, glyph) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.glyph = glyph;
    return true;
  }

  setLabel(iconId, label) {
    const icon = this.get(iconId);
    if (!icon) return false;
    icon.label = label;
    return true;
  }

  toJSON() {
    return this.list();
  }

  restore(icons = []) {
    this.icons.clear();
    icons.forEach((icon, index) => this.register({ order: index, ...icon }));
  }
}

export default DesktopIconManager;
