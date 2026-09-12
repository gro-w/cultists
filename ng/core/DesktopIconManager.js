export class DesktopIconManager {
  constructor({ root, windowManager, eventBus } = {}) { this.root = root; this.windowManager = windowManager; this.eventBus = eventBus; this.icons = []; }
  setIcons(icons) { this.icons = structuredClone(icons).sort((a, b) => (a.position?.order ?? a.order ?? 0) - (b.position?.order ?? b.order ?? 0)); this.render(); }
  render() { this.root.replaceChildren(); for (const icon of this.icons.filter((item) => item.visible !== false)) { const button = document.createElement("button"); button.className = "desktop-icon"; button.dataset.iconId = icon.id; button.innerHTML = `<span class="desktop-icon-logo"></span><span></span>`; button.querySelector(".desktop-icon-logo").textContent = typeof icon.logo === "string" ? icon.logo : icon.logo?.value || "▣"; button.lastChild.textContent = icon.label || icon.id; button.addEventListener("dblclick", () => this.windowManager.open(icon.windowId)); this.root.append(button); } }
  snapshot() { return this.icons.map((icon) => structuredClone(icon)); }
}
