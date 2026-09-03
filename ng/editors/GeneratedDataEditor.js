// DEV-TOOLS:START
export class GeneratedDataEditor {
  constructor({ structure, records = [] } = {}) { this.structure = structure; this.records = records; }
  mount(root) { root.replaceChildren(); const title = document.createElement("h3"); title.textContent = this.structure.displayName; root.append(title); for (const record of this.records) { const row = document.createElement("div"); row.textContent = JSON.stringify(record); root.append(row); } }
}
// DEV-TOOLS:END
