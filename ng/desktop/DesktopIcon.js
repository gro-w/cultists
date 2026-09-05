/**
 * DesktopIcon - renders icons from `DesktopIconManager.list()` (plan §8.1/
 * §8.2). Supports two position modes per icon:
 * - `grid`: normal flow order in the icon layer, drag-and-drop reorders
 *   via `onReorder(iconId, newOrder)` (persisted through
 *   `DesktopIconManager.reorder`).
 * - `free`: absolute `x`/`y` placement, drag-and-drop calls
 *   `onFreeMove(iconId, x, y)` instead of reordering.
 * Double-click always calls `onActivate(icon)`, which the caller (engine.js)
 * routes through the icon's declared `blueprintId` - never a
 * windowId/activityId shortcut baked into this renderer.
 */
export function renderDesktopIcons(rootEl, icons, { onActivate, onReorder, onFreeMove } = {}) {
  rootEl.innerHTML = "";
  icons.forEach((icon, displayIndex) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "desktop-icon";
    el.draggable = true;
    el.dataset.iconId = icon.iconId;
    if (icon.position?.mode === "free") {
      el.classList.add("desktop-icon-free");
      el.style.left = `${icon.position.x || 0}px`;
      el.style.top = `${icon.position.y || 0}px`;
    }
    el.innerHTML = `
      <span class="icon-glyph">${icon.glyph || "🗂"}</span>
      <span class="icon-label">${icon.label}</span>
    `;
    el.addEventListener("dblclick", () => onActivate?.(icon));
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/desktop-icon-id", icon.iconId);
    });
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/desktop-icon-id");
      if (!draggedId || draggedId === icon.iconId) return;
      onReorder?.(draggedId, displayIndex);
    });
    rootEl.appendChild(el);
  });
  // Dropping on empty desktop space: a free-position icon lands wherever
  // released; a grid icon dropped past the last one appends to the end.
  rootEl.addEventListener("dragover", (e) => e.preventDefault());
  rootEl.addEventListener("drop", (e) => {
    if (e.target !== rootEl) return;
    const draggedId = e.dataTransfer.getData("text/desktop-icon-id");
    if (!draggedId) return;
    const dragged = icons.find((icon) => icon.iconId === draggedId);
    if (dragged?.position?.mode === "free") {
      const rect = rootEl.getBoundingClientRect();
      onFreeMove?.(draggedId, Math.max(0, e.clientX - rect.left), Math.max(0, e.clientY - rect.top));
    } else {
      onReorder?.(draggedId, icons.length);
    }
  });
}

export default renderDesktopIcons;
