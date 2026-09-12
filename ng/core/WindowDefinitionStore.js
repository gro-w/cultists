export class WindowDefinitionStore {
  constructor(store) { this.store = store; this.definitions = new Map(); }
  async load(ids = []) { for (const id of ids) { const definition = await this.store.loadJSON(`windows/${id}.json`); this.definitions.set(definition.id, definition); } return this.definitions; }
  get(id) { return this.definitions.get(id); }
  list() { return [...this.definitions.values()]; }
}
