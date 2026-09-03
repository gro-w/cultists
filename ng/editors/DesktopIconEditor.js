// DEV-TOOLS:START
export class DesktopIconEditor {
  constructor({ iconManager } = {}) { this.iconManager = iconManager; }
  mount(root) { root.replaceChildren(); for (const icon of this.iconManager.icons) { const row = document.createElement("div"); row.textContent = `${icon.id} · ${icon.label || ""}`; root.append(row); } }
}
// DEV-TOOLS:END
