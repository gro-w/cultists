export class ActivityDefinitionStore {
  constructor() { this.definitions = new Map(); }
  register(definition) { if (!definition?.id || this.definitions.has(definition.id)) throw new Error(`Invalid or duplicate activity: ${definition?.id}`); this.definitions.set(definition.id, structuredClone(definition)); return definition; }
  get(id) { return this.definitions.get(id); }
  list() { return [...this.definitions.values()]; }
  replace(definition) { if (!definition?.id) throw new Error("Activity id is required"); this.definitions.set(definition.id, structuredClone(definition)); }
}
