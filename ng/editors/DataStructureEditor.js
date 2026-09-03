// DEV-TOOLS:START
export class DataStructureEditor {
  constructor({ structures } = {}) { this.structures = structures; }
  mount(root) { root.replaceChildren(); for (const definition of this.structures.definitions.values()) { const row = document.createElement("div"); row.textContent = `${definition.displayName || definition.id}（${definition.fields?.length || 0} 字段）`; root.append(row); } }
}
// DEV-TOOLS:END
