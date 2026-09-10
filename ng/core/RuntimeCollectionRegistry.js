/**
 * Generic runtime collection registry.
 *
 * Core owns only collection registration, opaque mutation, and snapshot/restore.
 * Collection identifiers, record sources, and mutation semantics are declared by
 * NGL/data packages; no game or framework domain is named here.
 */
export class RuntimeCollectionRegistry {
  constructor({ dataStore, eventBus } = {}) {
    this.dataStore = dataStore;
    this.eventBus = eventBus;
    this.definitions = new Map();
    this.state = new Map();
  }

  loadDefinitions(collections = {}) {
    for (const [id, definition] of Object.entries(collections || {})) {
      if (!definition || typeof definition !== "object") continue;
      this.definitions.set(id, structuredClone(definition));
      if (!this.state.has(id)) this.state.set(id, new Map());
    }
  }

  register(id, definition = {}) {
    const key = String(id || "");
    if (!key) throw new Error("Runtime collection id is required");
    this.definitions.set(key, structuredClone(definition));
    if (!this.state.has(key)) this.state.set(key, new Map());
  }

  definition(id) {
    return this.definitions.get(String(id)) || null;
  }

  _records(id) {
    const definition = this.definition(id);
    if (!definition?.databaseId || !this.dataStore) return [];
    return this.dataStore.findRecords(definition.databaseId, definition.query || {});
  }

  get(id) {
    const key = String(id);
    const definition = this.definition(key);
    const records = this._records(key);
    const values = this.state.get(key) || new Map();
    if (!definition) return [];
    if (definition.stateOnly) {
      return [...values.entries()].map(([recordId, value]) => ({ id: recordId, ...(value && typeof value === "object" ? value : { value }) }));
    }
    if (definition.mergeState) {
      return records.map((record) => {
        const recordId = String(record[definition.keyField || "id"]);
        const value = values.get(recordId);
        if (value && typeof value === "object") return { ...record, ...value };
        if (value !== undefined && definition.stateField) return { ...record, [definition.stateField]: value };
        return record;
      });
    }
    if (!definition.stateField) return records;
    return records
      .filter((record) => values.has(String(record[definition.keyField || "id"])))
      .map((record) => ({
        ...record,
        [definition.stateField]: values.get(String(record[definition.keyField || "id"])),
      }));
  }

  set(id, recordId, value) {
    const key = String(id);
    if (!this.definitions.has(key)) throw new Error(`Unknown runtime collection: ${key}`);
    const values = this.state.get(key) || new Map();
    const normalizedRecordId = String(recordId);
    if (value === null || value === undefined || value === false || value === 0 || value === "") values.delete(normalizedRecordId);
    else values.set(normalizedRecordId, structuredClone(value));
    this.state.set(key, values);
    this.eventBus?.emit("runtime:collection-changed", { collectionId: key, recordId: normalizedRecordId });
    return value;
  }

  mutate(id, recordId, operation = "set", value = 0) {
    const key = String(id);
    const values = this.state.get(key) || new Map();
    const currentValue = values.get(String(recordId));
    const current = Number(currentValue || 0);
    const next = operation === "delta" ? current + Number(value || 0) : operation === "merge"
      ? { ...(currentValue && typeof currentValue === "object" ? currentValue : {}), ...(value || {}) }
      : value;
    return this.set(key, recordId, next);
  }

  /** Apply a generic guarded operation atomically; failures do not mutate state. */
  operation(id, recordId, { operation = "delta", value = 0, minimum = 0 } = {}) {
    const key = String(id);
    if (!this.definitions.has(key)) throw new Error(`Unknown runtime collection: ${key}`);
    const normalizedRecordId = String(recordId);
    const values = this.state.get(key) || new Map();
    const previous = values.get(normalizedRecordId);
    const current = Number(previous || 0);
    let next;
    if (operation === "delta") next = current + Number(value || 0);
    else if (operation === "setIfAbsent") {
      if (values.has(normalizedRecordId)) return { ok: false, reason: "already-present", previous, current };
      next = value;
    } else if (operation === "set") next = value;
    else throw new Error(`Unknown runtime collection operation: ${operation}`);
    if (typeof next === "number" && next < Number(minimum)) return { ok: false, reason: "insufficient", previous, current, next };
    this.set(key, normalizedRecordId, next);
    return { ok: true, operation, recordId: normalizedRecordId, previous, current: next };
  }

  setCollectionValue(id, recordId, value) {
    return this.set(id, recordId, value);
  }

  mutateCollection(id, recordId, operation, value) {
    return this.mutate(id, recordId, operation, value);
  }

  appendCollectionValue(id, value) {
    const key = String(id);
    const values = this.state.get(key) || new Map();
    const index = String(values.size);
    return this.set(key, index, value);
  }

  snapshot() {
    return Object.fromEntries([...this.state.entries()].map(([id, values]) => [id, Object.fromEntries(values)]));
  }

  restore(snapshot = {}) {
    for (const id of this.definitions.keys()) {
      const values = new Map(Object.entries(snapshot[id] || {}));
      this.state.set(id, values);
    }
    this.eventBus?.emit("runtime:collection-changed", { restored: true });
  }
}

export default RuntimeCollectionRegistry;
