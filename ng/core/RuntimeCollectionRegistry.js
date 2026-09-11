/**
 * Generic runtime collection registry.
 *
 * Core owns only collection registration, opaque mutation, and snapshot/restore.
 * Collection identifiers, record sources, and mutation semantics are declared by
 * NGL/data packages; no game or framework domain is named here.
 */
export class RuntimeCollectionRegistry {
  constructor({ dataStore, eventBus, variableStore = null, publicVariableManager = null, publicStateVariableId = null } = {}) {
    this.dataStore = dataStore;
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.definitions = new Map();
    this.state = new Map();
    this.publicVariableManager = publicVariableManager;
    this.publicStateVariableId = publicStateVariableId;
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
    if (definition?.generatedRange) {
      const range = definition.generatedRange;
      const start = Number(range.start ?? 1);
      const count = Math.max(0, Number(range.count ?? 0));
      const current = Number(this.variableStore?.get?.(range.currentVariable) ?? 0);
      const unlockedThrough = Number(this.variableStore?.get?.(range.unlockedThroughVariable) ?? range.unlockedThrough ?? count);
      const restDays = new Set((range.restDays || []).map(Number));
      const nightDutyDays = new Set((range.nightDutyDays || []).map(Number));
      return Array.from({ length: count }, (_, offset) => {
        const day = start + offset;
        const locked = day > unlockedThrough;
        const rest = !locked && restDays.has(day);
        const night = !locked && nightDutyDays.has(day);
        const classes = [
          locked ? "calendar-locked-day" : rest ? "calendar-rest-day" : "calendar-duty-day",
          night ? "calendar-night-duty" : "",
          !locked && day === current ? "calendar-current-day" : "",
        ].filter(Boolean).join(" ");
        return {
          id: String(day),
          day,
          label: locked ? "未解锁" : rest ? "休息日" : night ? "夜班值班" : "工作日",
          statusClass: classes,
          locked,
        };
      });
    }
    if (!definition?.databaseId || !this.dataStore) return [];
    return this.dataStore.findRecords(definition.databaseId, definition.query || {});
  }

  get(id) {
    const key = String(id);
    const definition = this.definition(key);
    if (!definition) return [];
    const records = this._records(key);
    if (definition.nestedField) {
      const nestedRecords = records.flatMap((record) => (record?.[definition.nestedField] || []).map((nested, index) => ({
        ...nested,
        id: nested.id || `${record.id}__${index}`,
        sourceId: record.id,
        sourceName: record.name || record.label || "",
      })));
      if (!definition.mergeState) return nestedRecords;
      const nestedState = this.state.get(definition.stateCollectionId || key) || new Map();
      const mergedNested = nestedRecords.map((record) => ({
        ...record,
        ...(nestedState.get(String(record.id)) || {}),
      }));
      return definition.filterState
        ? mergedNested.filter((record) => Boolean(record[definition.stateField]))
        : mergedNested;
    }
    const values = this.state.get(key) || new Map();
    if (!definition) return [];
    if (definition.stateOnly) {
      return [...values.entries()].map(([recordId, value]) => ({ id: recordId, ...(value && typeof value === "object" ? value : { value }) }));
    }
    if (definition.mergeState) {
      const merged = records.map((record) => {
        const recordId = String(record[definition.keyField || "id"]);
        const value = values.get(recordId);
        if (value && typeof value === "object") return { ...record, ...value };
        if (value !== undefined && definition.stateField) return { ...record, [definition.stateField]: value };
        return record;
      });
      const filtered = definition.filterState
        ? merged.filter((record) => Boolean(record[definition.stateField]))
        : merged;
      const withDefaults = definition.defaults
        ? filtered.map((record) => ({ ...definition.defaults, ...record }))
        : filtered;
      const withProgress = definition.progressField
        ? withDefaults.map((record) => {
          const target = String(definition.progressTargetPath || "target").split(".")
            .reduce((value, key) => value == null ? undefined : value[key], record);
          if (!Number.isFinite(Number(target)) || Number(target) <= 0) return record;
          return {
            ...record,
            progressPercent: Math.max(0, Math.min(100, Math.round((Number(record[definition.progressField] || 0) / Number(target)) * 100))),
          };
        })
        : withDefaults;
      return this._applySort(this._applyFilters(withProgress, definition.filters), definition.sort);
    }
    if (!definition.stateField) return this._applySort(this._applyFilters(records, definition.filters), definition.sort);
    return this._applySort(this._applyFilters(records
      .filter((record) => values.has(String(record[definition.keyField || "id"])))
      .map((record) => ({
        ...record,
        [definition.stateField]: values.get(String(record[definition.keyField || "id"])),
      })), definition.filters), definition.sort);
  }

  _applyFilters(records, filters = []) {
    return (filters || []).reduce((result, filter) => {
      const current = this.variableStore?.get?.(filter.variable);
      if (current === undefined || current === null || current === "" || current === "all") return result;
      const operator = filter.operator || "eq";
      return result.filter((record) => {
        const left = record?.[filter.field] ?? filter.missingValue;
        return operator === "contains"
          ? (Array.isArray(left) && left.map(String).includes(String(current)))
          : operator === "neq"
          ? String(left) !== String(current)
          : String(left) === String(current);
      });
    }, records);
  }

  _applySort(records, sort) {
    if (!sort) return records;
    const mode = this.variableStore?.get?.(sort.variable) || sort.defaultMode || "pinyin";
    const field = mode === "day" ? (sort.dayField || "collectedDay") : mode === "category" ? (sort.categoryField || "category") : (sort.textField || "content");
    const groupKey = (record) => {
      const raw = String(record?.[field] ?? "");
      if (mode !== "pinyin") return raw;
      const first = [...raw][0] || "";
      return sort.initialMap?.[first] || first.toUpperCase() || "#";
    };
    const sorted = [...records].sort((left, right) => groupKey(left).localeCompare(groupKey(right), "zh-Hans-CN", { numeric: true })
      || String(left?.[field] ?? "").localeCompare(String(right?.[field] ?? ""), "zh-Hans-CN", { numeric: true }));
    if (!sort.group) return sorted;
    return sorted.map((record) => {
      const raw = record?.[field];
      const groupTitle = mode === "day"
        ? (raw == null || raw === "" ? "未知天数" : `第 ${raw} 天`)
        : mode === "category"
          ? String(raw || "misc")
          : groupKey(record);
      return { ...record, groupTitle };
    });
  }

  getRecord(id, recordId) {
    return this.get(id).find((item) => String(item?.id) === String(recordId)) || null;
  }

  set(id, recordId, value) {
    const key = String(id);
    if (!this.definitions.has(key)) throw new Error(`Unknown runtime collection: ${key}`);
    const values = this.state.get(key) || new Map();
    const normalizedRecordId = String(recordId);
    if (value === null || value === undefined || value === false || value === 0 || value === "") values.delete(normalizedRecordId);
    else values.set(normalizedRecordId, structuredClone(value));
    this.state.set(key, values);
    this._syncPublicState();
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

  incrementField(id, recordId, field, delta = 1) {
    const key = String(id);
    const normalizedRecordId = String(recordId);
    const values = this.state.get(key) || new Map();
    const current = values.get(normalizedRecordId);
    const record = current && typeof current === "object" ? current : {};
    const next = { ...record, [field]: Number(record[field] || 0) + Number(delta || 0) };
    this.set(key, normalizedRecordId, next);
    return next;
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
    this._syncPublicState();
  }

  _syncPublicState() {
    if (!this.publicVariableManager || this.publicStateVariableId == null) return;
    const value = {};
    for (const [collectionId, records] of this.state.entries()) value[collectionId] = Object.fromEntries(records);
    this.publicVariableManager.set(this.publicStateVariableId, value);
  }
}

export default RuntimeCollectionRegistry;
