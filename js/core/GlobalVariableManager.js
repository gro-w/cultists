import { dataLoader } from "./DataLoader.js";
import { eventBus } from "./EventBus.js";

const TYPES = new Set(["bool", "number", "decimal", "string"]);
const OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
const RESERVED_MIN_ID = 0;
const RESERVED_MAX_ID = 99;

export const RESERVED_GLOBAL_VARIABLE_MIN_ID = RESERVED_MIN_ID;
export const RESERVED_GLOBAL_VARIABLE_MAX_ID = RESERVED_MAX_ID;

function reservedDefinition(id) {
  if (id < RESERVED_MIN_ID || id > RESERVED_MAX_ID) return null;
  if (id === 0) return { id, name: "怀疑度", type: "number", default: 0 };
  if (id === 1) return { id, name: "主角SAN", type: "number", default: 100 };
  if (id === 2) return { id, name: "金钱", type: "decimal", default: 0 };
  if (id === 5) return { id, name: "ChatGTP SAN", type: "number", default: 80 };
  if (id >= 20 && id < 40) return { id, name: `主角技能${id - 20}点`, type: "number", default: 0 };
  if (id >= 40 && id < 60) return { id, name: `NPC${id - 40}好感度`, type: "number", default: 0 };
  if (id >= 60 && id < 80) return { id, name: `NPC${id - 60} SAN`, type: "number", default: 0 };
  return { id, name: `预留变量${id}`, type: "number", default: 0 };
}

export function isReservedGlobalVariableId(id) {
  const normalized = variableId(id);
  return normalized !== null && normalized >= RESERVED_MIN_ID && normalized <= RESERVED_MAX_ID;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function variableId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function roundDecimal(value) {
  return Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100) / 100;
}

/** Owns named, data-defined variables shared by dialogue and event systems. */
class GlobalVariableManager {
  constructor() {
    this.definitions = [];
    this.values = new Map();
    this._initPromise = null;
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("global_variables.json").then((data) => {
        this.replaceDefinitions(Array.isArray(data) ? data : Array.isArray(data?.variables) ? data.variables : [], { emit: false });
      });
    }
    return this._initPromise;
  }

  definition(id) {
    const normalized = variableId(id);
    return normalized == null ? null : this.definitions.find((definition) => definition.id === normalized) || null;
  }

  isReserved(id) {
    return isReservedGlobalVariableId(id);
  }

  get(id) {
    const definition = this.definition(id);
    return definition ? this.values.get(definition.id) : undefined;
  }

  _coerce(definition, value) {
    if (definition.type === "bool") {
      if (typeof value !== "boolean") throw new Error(`Global variable ${definition.id} must be bool`);
      return value;
    }
    if (definition.type === "number" || definition.type === "decimal") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 256) {
        throw new Error(`Global variable ${definition.id} must be a number from 0 to 256`);
      }
      if (definition.type === "decimal") return roundDecimal(number);
      return number;
    }
    if (typeof value !== "string") throw new Error(`Global variable ${definition.id} must be string`);
    return value;
  }

  set(id, value, { emit = true } = {}) {
    const definition = this.definition(id);
    if (!definition) throw new Error(`Unknown global variable: ${id}`);
    const next = this._coerce(definition, value);
    const previous = this.values.get(definition.id);
    this.values.set(definition.id, next);
    if (emit && previous !== next) eventBus.emit("global-variable:changed", { id: definition.id, name: definition.name, previous, value: next });
    return next;
  }

  modify(id, change, options = {}) {
    const definition = this.definition(id);
    if (!definition || !["number", "decimal"].includes(definition.type)) throw new Error(`Only numeric variables can be modified: ${id}`);
    return this.set(definition.id, this.get(definition.id) + Number(change), options);
  }

  replaceDefinitions(rawDefinitions, { emit = true } = {}) {
    if (!Array.isArray(rawDefinitions)) throw new Error("Global variables must be an array");
    const definitions = rawDefinitions.map((raw) => {
      const id = variableId(raw?.id);
      if (id == null) throw new Error("Global variable IDs must be integers from 0");
      if (!raw.name || typeof raw.name !== "string") throw new Error(`Global variable ${id} needs a name`);
      if (!TYPES.has(raw.type)) throw new Error(`Invalid global variable type for ${id}`);
      const definition = { id, name: raw.name, type: raw.type };
      definition.default = this._coerce(definition, raw.default ?? (raw.type === "bool" ? false : ["number", "decimal"].includes(raw.type) ? 0 : ""));
      return definition;
    });
    if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) throw new Error("Global variable IDs must be unique");
    for (let id = RESERVED_MIN_ID; id <= RESERVED_MAX_ID; id += 1) {
      const actual = definitions.find((definition) => definition.id === id);
      const expected = reservedDefinition(id);
      if (!actual) throw new Error(`Reserved global variable ${id} cannot be deleted`);
      if (actual.name !== expected.name || actual.type !== expected.type) {
        throw new Error(`Reserved global variable ${id} cannot be modified`);
      }
    }
    definitions.sort((a, b) => a.id - b.id);
    const oldValues = this.values;
    this.definitions = definitions;
    this.values = new Map(definitions.map((definition) => {
      const old = oldValues.get(definition.id);
      try { return [definition.id, old === undefined ? definition.default : this._coerce(definition, old)]; }
      catch { return [definition.id, definition.default]; }
    }));
    if (emit) eventBus.emit("global-variables:changed", this.snapshot());
  }

  matches(condition) {
    if (!condition) return true;
    if (Array.isArray(condition)) return condition.every((item) => this.matches(item));
    if (condition.globalVariables) return this.matches(condition.globalVariables);
    if (condition.all) return this.matches(condition.all);
    if (condition.any) return condition.any.some((item) => this.matches(item));
    const id = condition.id ?? condition.variableId;
    const definition = this.definition(id);
    const actual = this.get(id);
    if (!definition || actual === undefined) return false;
    const normalizeExpected = (value) => {
      try { return ["number", "decimal"].includes(definition.type) ? this._coerce(definition, value) : value; }
      catch { return undefined; }
    };
    if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
      const expected = normalizeExpected(condition.equals);
      return expected !== undefined && actual === expected;
    }
    if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) {
      const expected = normalizeExpected(condition.notEquals);
      return expected !== undefined && actual !== expected;
    }
    const operator = condition.op || "eq";
    if (!OPERATORS.has(operator)) return false;
    const expected = normalizeExpected(condition.value);
    if (expected === undefined) return false;
    if (operator === "eq") return actual === expected;
    if (operator === "neq") return actual !== expected;
    if (operator === "gt") return actual > expected;
    if (operator === "gte") return actual >= expected;
    if (operator === "lt") return actual < expected;
    return actual <= expected;
  }

  applyEffects(effects = []) {
    if (!Array.isArray(effects)) return;
    effects.forEach((effect) => {
      const id = effect?.id ?? effect?.variableId;
      if (Object.prototype.hasOwnProperty.call(effect || {}, "value")) this.set(id, effect.value);
      else if (Object.prototype.hasOwnProperty.call(effect || {}, "delta")) this.modify(id, effect.delta);
    });
  }

  snapshot() {
    return this.definitions.map((definition) => ({ id: definition.id, value: clone(this.values.get(definition.id)) }));
  }

  restore(entries = []) {
    if (!Array.isArray(entries)) throw new Error("Invalid global variable state");
    this.values = new Map(this.definitions.map((definition) => [definition.id, definition.default]));
    entries.forEach((entry) => {
      if (this.definition(entry?.id)) this.set(entry.id, entry.value, { emit: false });
    });
    eventBus.emit("global-variables:changed", this.snapshot());
  }

  all() {
    return this.definitions.map((definition) => ({ ...definition, value: clone(this.values.get(definition.id)) }));
  }
}

export const globalVariableManager = new GlobalVariableManager();
export default GlobalVariableManager;
