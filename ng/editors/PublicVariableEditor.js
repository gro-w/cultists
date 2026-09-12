// DEV-TOOLS:START
export class PublicVariableEditor {
  constructor({ variables } = {}) { this.variables = variables; }
  mount(root) { root.replaceChildren(); for (const definition of this.variables.definitions.values()) { const row = document.createElement("label"); row.textContent = `${definition.id} · ${definition.name}`; const input = document.createElement("input"); input.value = String(this.variables.get(definition.id)); input.addEventListener("change", () => this.variables.set(definition.id, definition.type === "smallInteger" ? Number(input.value) : input.value)); row.append(input); root.append(row); } }
}
// DEV-TOOLS:END
