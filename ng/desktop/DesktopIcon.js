/**
 * DesktopIcon - Phase 1 icon *placeholders* only. Full drag/reorder,
 * persisted custom layout and blueprint-routed double-click actions are
 * DesktopIconManager's job in Phase 5; here we just render a fixed list and
 * let the caller decide what a double-click does.
 */
export function renderDesktopIcons(rootEl, icons, onActivate) {
  rootEl.innerHTML = "";
  for (const icon of icons) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "desktop-icon";
    el.innerHTML = `
      <span class="icon-glyph">${icon.glyph || "🗂"}</span>
      <span class="icon-label">${icon.label}</span>
    `;
    el.addEventListener("dblclick", () => onActivate(icon));
    rootEl.appendChild(el);
  }
}

export default renderDesktopIcons;
