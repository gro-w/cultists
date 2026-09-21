import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";
import { normalizeBlueprint, validateBlueprint } from "./ActivityValidator.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function clone(value) { return value == null ? value : structuredClone(value); }
function lineColumn(source, offset) {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const last = before.lastIndexOf("\n");
  return { line, column: offset - last };
}
function diagnostic(source, offset, message, code = "CL2_SYNTAX") {
  const position = lineColumn(source, offset);
  return { code, message, line: position.line, column: position.column };
}

class Cursor {
  constructor(source) { this.source = source; this.index = 0; }
  get eof() { return this.index >= this.source.length; }
  skip() {
    while (!this.eof) {
      const rest = this.source.slice(this.index);
      const whitespace = rest.match(/^\s+/);
      if (whitespace) { this.index += whitespace[0].length; continue; }
      if (rest.startsWith("/*")) { const end = this.source.indexOf("*/", this.index + 2); this.index = end < 0 ? this.source.length : end + 2; continue; }
      break;
    }
  }
  peek(value) { this.skip(); return this.source.startsWith(value, this.index); }
  take(value) { this.skip(); if (!this.source.startsWith(value, this.index)) return false; this.index += value.length; return true; }
  expect(value, diagnostics) {
    if (this.take(value)) return true;
    diagnostics.push(diagnostic(this.source, this.index, `Expected "${value}"`));
    return false;
  }
  identifier(diagnostics) {
    this.skip();
    const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/);
    if (!match) { diagnostics.push(diagnostic(this.source, this.index, "Expected identifier")); return null; }
    this.index += match[0].length;
    return match[0];
  }
  declarationIdentifier(diagnostics) {
    this.skip();
    const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_.-]*/);
    if (!match) { diagnostics.push(diagnostic(this.source, this.index, "Expected declaration identifier")); return null; }
    this.index += match[0].length;
    return match[0];
  }
  balanced(open, close, diagnostics) {
    this.skip();
    if (!this.take(open)) { diagnostics.push(diagnostic(this.source, this.index, `Expected "${open}"`)); return null; }
    const start = this.index;
    let depth = 1; let quote = null; let escaped = false;
    while (!this.eof) {
      const ch = this.source[this.index++];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === open) depth += 1;
      else if (ch === close && --depth === 0) return this.source.slice(start, this.index - 1);
    }
    diagnostics.push(diagnostic(this.source, start - 1, `Unclosed "${open}"`));
    return this.source.slice(start);
  }
}

function splitTopLevel(text) {
  const result = []; let start = 0; let depth = 0; let quote = null; let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (text.slice(start).trim()) result.push(text.slice(start).trim());
  return result;
}

function parseLiteral(text) {
  const value = text.trim();
  if (!value) return undefined;
  if (/^[A-Za-z_][A-Za-z0-9_.:-]*\[\]$/.test(value)) return { reusable: value.slice(0, -2) };
  if (value.startsWith("{") || value.startsWith("[")) {
    try { return JSON.parse(value); } catch { /* fall through to expression */ }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try { return JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1).replaceAll('"', '\\"')}"` : value); } catch { return value.slice(1, -1); }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number(value);
  return { expression: value };
}

function functionNameToType(name) { return name === "end" ? "activityEnd" : name; }
function inputPorts(type) { return getActivityNodeDefinition(type)?.valueInputs || []; }
function literalType(value, reusable) {
  if (value?.nodeId) return reusable[value.nodeId]?.outputType || "any";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "any";
}
function makeInputs(type, args, reusable = {}) {
  if (type === "addWindowComponent" && args.length === 6
    && typeof args[0] === "string" && typeof args[1] === "string"
    && typeof args[2] === "string" && typeof args[3] === "string"
    && typeof args[4] === "number" && args[5] && typeof args[5] === "object") {
    return {
      windowId: args[0],
      parentId: args[1],
      componentType: args[2],
      resultVariable: args[3],
      maxCount: args[4],
      properties: args[5],
    };
  }
  // The canonical CL2 emitted from the legacy display contract keeps the
  // routing target first: text(displayTo, speaker, text, continueKey) (or
  // text(displayTo, speaker, text, keywordIds, continueKey)).  The runtime
  // node registry intentionally exposes the generic port order
  // speaker/text/displayTo/keywordIds/continueKey; do not let the generic
  // type-aware positional matcher reinterpret this content-facing contract.
  if (type === "text" && args.length >= 3 && args.length <= 5) {
    return {
      displayTo: args[0],
      speaker: args[1],
      text: args[2],
      ...(args.length === 4 ? { continueKey: args[3] } : {}),
      ...(args.length === 5 ? { keywordIds: args[3], continueKey: args[4] } : {}),
    };
  }
  const ports = inputPorts(type);
  const inputs = {};
  const unused = ports.map((port) => port.name);
  args.forEach((arg, index) => {
    const actualType = literalType(arg, reusable);
    const positional = ports[index];
    const matches = (port) => port && (port.type === "any" || actualType === "any" || port.type === actualType);
    const selected = matches(positional) ? positional : ports.find((port) => unused.includes(port.name) && matches(port));
    const name = selected?.name || positional?.name || `arg${index + 1}`;
    const position = unused.indexOf(name);
    if (position >= 0) unused.splice(position, 1);
    inputs[name] = arg;
  });
  return inputs;
}
function resolveValue(value, reusable) {
  if (value?.nodeId && !reusable[value.nodeId] && reusable[`${value.nodeId}__value`]) {
    return { ...reusable[`${value.nodeId}__value`], port: value.port || "value" };
  }
  if (value?.reusable) {
    const resolved = reusable[value.reusable] || reusable[`${value.reusable}__value`];
    return resolved || { nodeId: value.reusable, port: "value" };
  }
  if (value?.expression) return { expression: value.expression };
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, reusable));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, reusable)]));
  return value;
}
function optionNumber(label) {
  const match = String(label).match(/^option<(\d+)>$/);
  return match ? Number(match[1]) : null;
}
function flowPortFor(type, label) {
  if (label === "default") {
    if (type === "branch" || type === "if") return "false";
    if (type === "framework:diceCheck") return "largeFailure";
    const customOutputs = getActivityNodeDefinition(type)?.flowOutputs || [];
    if (!customOutputs.some((port) => port.name === "flowOut")) return customOutputs[0]?.name || "flowOut";
    return "flowOut";
  }
  const n = optionNumber(label);
  if (n == null) return label;
  if (type === "branch" || type === "if") return n === 1 ? "true" : "false";
  if (type === "choice") return `option${n - 1}`;
  if (type === "framework:diceCheck") return ["largeSuccess", "success", "failure"][n - 1] || label;
  if (type === "framework:randomBranch") return `flowOut${n - 1}`;
  if (type === "check") return ["largeSuccess", "success", "failure"][n - 1] || "largeFailure";
  if (type === "san") return `segment${n - 1}`;
  return n === 1 ? "flowOut" : `flowOut${n - 1}`;
}

function parseFunction(cursor, diagnostics, bracket) {
  const name = cursor.identifier(diagnostics);
  if (!name) return null;
  const rawArgs = cursor.balanced(bracket ? "[" : "(", bracket ? "]" : ")", diagnostics);
  if (rawArgs == null) return { name, args: [] };
  return { name, args: splitTopLevel(rawArgs).map(parseLiteral) };
}

export function parseCl2(source, { sourcePath = "<inline>", validate = true } = {}) {
  const text = String(source || "");
  const cursor = new Cursor(text);
  const diagnostics = [];
  const reusableEntries = [];
  const inputValues = [];
  const flowEntries = [];
  while (!cursor.eof) {
    cursor.skip();
    if (cursor.eof) break;
    const start = cursor.index;
    const keyword = cursor.declarationIdentifier(diagnostics);
    if (!keyword) { cursor.index += 1; continue; }
    if (keyword === "reusablevalue" || keyword === "inputvalue") {
      const id = cursor.declarationIdentifier(diagnostics);
      cursor.expect(":", diagnostics);
      const fn = parseFunction(cursor, diagnostics, true);
      cursor.expect(";", diagnostics);
      (keyword === "reusablevalue" ? reusableEntries : inputValues).push({ id, fn, start });
      continue;
    }
    const id = keyword;
    if (!IDENTIFIER.test(id)) diagnostics.push(diagnostic(text, start, `Invalid node id "${id}"`, "CL2_ID"));
    cursor.expect(":", diagnostics);
    const fn = parseFunction(cursor, diagnostics, false);
    const body = cursor.peek("{") ? cursor.balanced("{", "}", diagnostics) : null;
    cursor.expect(";", diagnostics);
    const tail = text.slice(cursor.index, text.indexOf("\n", cursor.index) < 0 ? text.length : text.indexOf("\n", cursor.index));
    const position = tail.match(/@cl2\.pos\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    const edges = [];
    if (body != null) {
      const edgePattern = /(option<[^>]+>|default)\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*;/g;
      let match;
      while ((match = edgePattern.exec(body))) edges.push({ label: match[1], target: match[2] });
    }
    flowEntries.push({ id, fn, edges, position: position ? { x: Number(position[1]), y: Number(position[2]) } : null, start });
  }

  const reusable = {};
  const valueNodes = {};
  for (const entry of reusableEntries) {
    if (!entry.id || reusable[entry.id]) diagnostics.push(diagnostic(text, entry.start, `Duplicate reusable value "${entry.id}"`, "CL2_DUPLICATE_ID"));
    const type = functionNameToType(entry.fn?.name || "");
    const node = { id: entry.id, type, inputs: {}, next: {} };
    node.inputs = makeInputs(type, (entry.fn?.args || []).map((value) => resolveValue(value, reusable)), reusable);
    valueNodes[entry.id] = node;
    reusable[entry.id] = { nodeId: entry.id, port: "value", outputType: getActivityNodeDefinition(type)?.valueOutputs?.[0]?.type || "any" };
  }
  const nodes = { ...valueNodes };
  for (const entry of flowEntries) {
    const type = functionNameToType(entry.fn?.name || "");
    const node = { id: entry.id, type, inputs: {}, next: {} };
    node.inputs = makeInputs(type, (entry.fn?.args || []).map((value) => resolveValue(value, reusable)), reusable);
    if (entry.position) { node.x = entry.position.x; node.y = entry.position.y; }
    nodes[entry.id] = node;
  }
  for (const entry of inputValues) {
    let target = nodes[entry.id];
    if (!target) {
      target = { id: entry.id, type: functionNameToType(entry.fn?.name || ""), inputs: {}, next: {}, cl2Class: "valueReceiver" };
      nodes[entry.id] = target;
    } else {
      target.cl2Class = "valueReceiver";
    }
    const args = (entry.fn?.args || []).map((value) => resolveValue(value, reusable));
    Object.assign(target.inputs, makeInputs(target.type, args, reusable));
  }
  const flowIds = flowEntries.map((entry) => entry.id);
  flowEntries.forEach((entry, index) => {
    const node = nodes[entry.id];
    const edges = [...entry.edges];
    const definition = getActivityNodeDefinition(node.type);
    const hasDefaultPort = Boolean(definition?.flowOutputs?.some((port) => ["flowOut", "default", "false", "largeFailure", "onCreate"].includes(port.name)));
    if (!edges.some((edge) => edge.label === "default") && hasDefaultPort && index + 1 < flowIds.length && entry.fn?.name !== "end") edges.push({ label: "default", target: flowIds[index + 1], implicit: true });
    for (const edge of edges) {
      const target = nodes[edge.target];
      if (!target) { diagnostics.push(diagnostic(text, entry.start, `Flow target "${edge.target}" does not exist`, "CL2_TARGET")); continue; }
      node.next[flowPortFor(node.type, edge.label)] = { nodeId: edge.target, port: "flowIn", implicit: Boolean(edge.implicit) };
    }
  });
  const startNodeId = flowEntries.find((entry) => entry.fn?.name === "flowStart")?.id || null;
  const graph = normalizeBlueprint({ startNodeId, nodes });
  if (validate) {
    const result = validateBlueprint(graph);
    if (!result.ok) result.errors.forEach((message) => diagnostics.push({ code: "CL2_GRAPH", message, line: 0, column: 0 }));
  }
  const document = { sourcePath, source: text, reusableValues: reusableEntries, inputValues, flowNodes: flowEntries, graph, diagnostics };
  return { ok: diagnostics.length === 0, document, graph, diagnostics };
}

export default parseCl2;
