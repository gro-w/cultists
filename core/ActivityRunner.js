import { t } from "./i18n/index.js";
/**
 * ActivityRunner - node-by-node interpreter for a single Activity
 * instance's Blueprint (plan §13 Phase 2). Kept generic: the only node
 * types understood here are the ones in ActivityNodeRegistry.js.
 *
 * There is no dedicated "loop" node type: a loop is just an ordinary flow
 * cycle - one of a `branch` node's outputs is wired back to a node earlier
 * in the same flow, and the branch's own condition (backed by a variable a
 * loop-body `setVariable` updates each pass) is what eventually breaks the
 * cycle. `MAX_STEPS` below is the only safety net against a cycle that
 * never breaks.
 *
 * Resume semantics: one-shot side-effecting nodes (`setVariable`,
 * `consumeTime`, `openWindow`) are tracked in `instance.executedNodeIds` and skipped if
 * revisited after a save/restore mid-flow, exactly like the equivalent
 * "already executed" guard in the legacy engine's ActivityRunner. Decision
 * nodes (`branch`, `blockUntil`) always re-evaluate so they pick up
 * variable changes correctly on resume.
 */
import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";

const ONE_SHOT_NODE_TYPES = new Set([
  "setVariable", "setLocalVariable", "openWindow", "closeWindow", "runActivity", "insertActivity", "emitEvent", "addWindowComponent", "removeWindowComponent", "getWindowLayout",
  "setLanguage", "createRecord", "updateRecord", "deleteRecord", "applyPublicVariableEffect", "markEventState",
]);
const MAX_STEPS = 1000;

function nextFlow(blueprint, node, port = "flowOut") {
  return node.next?.[port]?.nodeId ?? null;
}

/**
 * Evaluate a pure value node's output on demand (plan §6.2 value-port
 * wiring). Value nodes (e.g. `arithmetic`, `getVariable`) are never
 * flow-stepped by `run()`; they are pulled lazily whenever a flow node's
 * value input is wired to one of their outputs, recursing through chained
 * value nodes. `stack` guards against circular wiring.
 */
export function evaluateValueOutput(blueprint, nodeId, portName, variableStore, stack, pvGateway = null, dbGateway = null, runtimeGateway = null) {
  const key = `${nodeId}:${portName}`;
  if (stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
  const node = blueprint.nodes[nodeId];
  if (!node) throw new Error(`Unknown value node: ${nodeId}`);
  stack.add(key);
  const read = (name, fallback) => resolveInput(blueprint, node, name, variableStore, fallback, stack, pvGateway, dbGateway, runtimeGateway);
  let result;
  switch (node.type) {
    case "arithmetic":
      result = applyArithmetic(read("operator", "+"), read("left", 0), read("right", 0));
      break;
    case "conditionalValue":
      result = read("condition", false) ? read("whenTrue") : read("whenFalse");
      break;
    case "getVariable":
      result = variableStore.get(read("key"));
      break;
    case "getLocalVariable":
      result = variableStore.get(`__local:${read("key")}`);
      break;
    case "getProperty": {
      const target = read("value");
      result = target == null ? undefined : target[read("key")];
      break;
    }
    case "getStructureDefinition":
      if (!dbGateway?.getStructureDefinition) throw new Error(t("error.ed9feb0cd2b5"));
      result = dbGateway.getStructureDefinition(read("structureId"));
      break;
    case "getDatabaseDefinition":
      if (!dbGateway?.getDatabaseDefinition) throw new Error(t("error.e67bc821c260"));
      result = dbGateway.getDatabaseDefinition(read("databaseId"));
      break;
    case "findRecordsValue": {
      if (!dbGateway) throw new Error(t("error.fa59af2e3c80"));
      result = dbGateway.findRecords(read("databaseId"), read("query", {}));
      break;
    }
    case "getRecordValue": {
      if (!dbGateway?.getRecord) throw new Error(t("error.535cdca40f3a"));
      result = dbGateway.getRecord(read("databaseId"), read("key"));
      break;
    }
    case "getRuntimeCollection": {
      if (!runtimeGateway?.getCollection) throw new Error(t("error.81a602d97338"));
      result = runtimeGateway.getCollection(read("collectionId")) || [];
      break;
    }
    case "getRuntimeRecord": {
      if (!runtimeGateway?.getRecord) throw new Error(t("error.ad111936dc7e"));
      result = runtimeGateway.getRecord(read("collectionId"), read("recordId"));
      break;
    }
    case "mergeRecords": {
      const keyField = read("keyField", "id");
      const right = read("right", []);
      const rightByKey = new Map((Array.isArray(right) ? right : []).map((record) => [record?.[keyField], record]));
      const left = read("left", []);
      result = (Array.isArray(left) ? left : []).map((record) => ({ ...record, ...(rightByKey.get(record?.[keyField]) || {}) }));
      break;
    }
    case "arrayAppend": {
      const array = read("array");
      result = [...(Array.isArray(array) ? array : []), read("item")];
      break;
    }
    case "getGameTime":
      result = variableStore.get("__gameTime") ?? 0;
      break;
    case "getActivityInstanceCount":
      result = variableStore.get(`__activityCount:${read("activityId")}`) ?? 0;
      break;
    case "getQueueEntryCount":
      if (!runtimeGateway?.listEntries) throw new Error(t("error.a54f6a6d6d07"));
      result = runtimeGateway.listEntries(read("queueId"), { status: "unresolved" }).length;
      break;
    case "addWindowComponent":
      result = variableStore.get(`__nodeResult:${node.id}:componentId`) ?? null;
      break;
    case "getPublicVariable": {
      if (!pvGateway) throw new Error(t("error.df5e69e177f6"));
      result = pvGateway.get(read("id"));
      break;
    }
    case "getLanguage":
      if (!runtimeGateway?.getLanguage) throw new Error(t("error.a8ffd3686ba6"));
      result = runtimeGateway.getLanguage();
      break;
    case "publicVariableCondition": {
      if (!pvGateway) throw new Error(t("error.3a14abbd1474"));
      result = pvGateway.evaluateCondition({ id: read("id"), op: read("op", "eq"), value: read("value") });
      break;
    }
    default: {
      const customDefinition = getActivityNodeDefinition(node.type);
      const output = customDefinition?.custom
        ? (customDefinition.valueOutputs || []).find((port) => port.name === portName)
        : null;
      if (!customDefinition?.custom || !customDefinition.blueprint || !output?.source) {
        throw new Error(`Node ${node.type} does not produce a value output`);
      }
      const replaceParameters = (value) => {
        if (Array.isArray(value)) return value.map(replaceParameters);
        if (!value || typeof value !== "object") return value;
        if (Object.keys(value).length === 1 && typeof value.parameter === "string") {
          return resolveInput(blueprint, node, value.parameter, variableStore, undefined, stack, pvGateway, dbGateway, runtimeGateway);
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceParameters(child)]));
      };
      const nestedBlueprint = structuredClone(customDefinition.blueprint);
      for (const nestedNode of Object.values(nestedBlueprint.nodes || {})) {
        nestedNode.inputs = replaceParameters(nestedNode.inputs || {});
      }
      result = evaluateValueOutput(
        nestedBlueprint,
        output.source.nodeId,
        output.source.port || "value",
        variableStore,
        stack,
        pvGateway,
        dbGateway,
        runtimeGateway,
      );
      break;
    }
  }
  stack.delete(key);
  return result;
}

function applyArithmetic(operator, left, right) {
  switch (operator) {
    case "+": return Number(left) + Number(right);
    case "-": return Number(left) - Number(right);
    case "*": return Number(left) * Number(right);
    case "/": if (Number(right) === 0) throw new Error(t("error.50a314209c54")); return Number(left) / Number(right);
    case "%": if (Number(right) === 0) throw new Error(t("error.50a314209c54")); return Number(left) % Number(right);
    case "and": return Boolean(left) && Boolean(right);
    case "or": return Boolean(left) || Boolean(right);
    case "xor": return Boolean(left) !== Boolean(right);
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "=": return left === right;
    case "not": return !Boolean(left);
    case "floor": return Math.floor(Number(left));
    // Generic entropy source: composed with value and flow operators,
    // this remains a host primitive rather than a domain-specific node.
    case "random": return Math.random();
    // Generic string concatenation (as opposed to "+"'s numeric coercion) -
    // e.g. building a display label or a lookup key from two variable-
    // sourced strings.
    case "concat": return String(left) + String(right);
    default: throw new Error(`Unknown arithmetic operator: ${operator}`);
  }
}

/**
 * Recursively resolves wire-refs (`{nodeId,port}`/`{variable}`) nested
 * anywhere inside a composite literal - e.g. `createRecord`'s `data` input
 * is itself a plain object whose *fields* are individually wired to value
 * nodes (a selected patient's id, a computed correctness bool, ...), not
 * the whole `data` input as one wire-ref. Without this, only a top-level
 * wire-ref would ever resolve and nested ones would pass through as inert
 * `{nodeId:...}` literals. Plain scalars/arrays/objects with no wire-refs
 * anywhere inside are returned unchanged (safe superset of the old
 * top-level-only behavior).
 */
function resolveDeep(blueprint, value, variableStore, stack, pvGateway, dbGateway, runtimeGateway) {
  if (Array.isArray(value)) return value.map((item) => resolveDeep(blueprint, item, variableStore, stack, pvGateway, dbGateway, runtimeGateway));
  if (value && typeof value === "object") {
    if ("nodeId" in value) return evaluateValueOutput(blueprint, value.nodeId, value.port || "value", variableStore, stack, pvGateway, dbGateway, runtimeGateway);
    if ("variable" in value) return variableStore.get(value.variable);
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = resolveDeep(blueprint, child, variableStore, stack, pvGateway, dbGateway, runtimeGateway);
    return out;
  }
  return value;
}

/**
 * Resolve one node's value input: a wired connection from another node's
 * value output takes precedence (evaluated lazily, following the node's
 * `inputs[name] = { nodeId, port }` upstream link - "数值只记录上家的链
 * 表"), then the legacy `{variable: name}` literal shorthand, then a plain
 * literal, then `fallback` - recursing into composite object/array
 * literals so any wire-refs nested inside them (e.g. `createRecord`'s
 * `data` fields) resolve too.
 */
export function resolveInput(blueprint, node, name, variableStore, fallback, stack = new Set(), pvGateway = null, dbGateway = null, runtimeGateway = null) {
  const raw = node.inputs ? node.inputs[name] : undefined;
  if (raw === undefined) return fallback;
  return resolveDeep(blueprint, raw, variableStore, stack, pvGateway, dbGateway, runtimeGateway);
}

export function createActivityRunner({
  definition,
  instance,
  variableStore,
  eventBus,
  timeGateway = () => {},
  windowGateway = () => {},
  activityGateway = () => {},
  eventGateway = () => {},
  dbGateway = null,
  pvGateway = null,
  runtimeGateway = null,
  eventStateGateway = null,
  onboardingGateway = eventStateGateway,
  apiGateway = null,
  onCheckpoint = () => {},
  onComplete = () => {},
} = {}) {
  const blueprint = definition.blueprint;
  let cancelled = false;
  let paused = false;
  let waitUnsubscribe = null;
  let lastDialogueDisplayTo = null;
  const globalVariableStore = variableStore;
  const declaredLocals = blueprint.localVariables && typeof blueprint.localVariables === "object" ? blueprint.localVariables : {};
  if (!instance.localVariables || Object.keys(instance.localVariables).length === 0) {
    instance.localVariables = structuredClone(Object.fromEntries(Object.entries(declaredLocals).map(([key, value]) => [key, value?.defaultValue ?? value])));
  }
  const localValues = new Map(Object.entries(instance.localVariables || {}));
  variableStore = {
    get: (key) => String(key).startsWith("__local:") ? localValues.get(String(key).slice(8)) : globalVariableStore.get(key),
    set: (key, value) => {
      if (String(key).startsWith("__local:")) {
        localValues.set(String(key).slice(8), value);
        instance.localVariables = Object.fromEntries(localValues);
      } else globalVariableStore.set(key, value);
    },
    delta: (key, amount) => {
      const current = Number(variableStore.get(key)) || 0;
      variableStore.set(key, current + (Number(amount) || 0));
    },
  };

  function markExecuted(node) {
    if (!instance.executedNodeIds.includes(node.id)) instance.executedNodeIds.push(node.id);
  }

  function finish(reason) {
    if (instance.status === "resolved") return;
    instance.status = "resolved";
    instance.resolutionReason = reason;
    instance.waitingNodeId = null;
    if (instance.currentStep) instance.currentStep = { ...instance.currentStep, status: reason };
    if (lastDialogueDisplayTo) {
      eventGateway("display:complete", {
        instanceId: instance.instanceId,
        displayTo: lastDialogueDisplayTo,
        reason,
      }, instance);
    }
    onCheckpoint(instance);
    onComplete(instance, reason);
  }

  function execute(node) {
    switch (node.type) {
      case "flowStart":
        return { next: nextFlow(blueprint, node) };
      case "activityEnd":
        finish("completed");
        return { stop: true };
      case "macroReturn":
        instance.returnPort = String(resolveInput(blueprint, node, "port", variableStore, "flowOut", undefined, pvGateway, dbGateway, runtimeGateway));
        finish("returned");
        return { stop: true };
      case "setVariable": {
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        if (Object.prototype.hasOwnProperty.call(node.inputs || {}, "delta")) {
          variableStore.delta(key, resolveInput(blueprint, node, "delta", variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway));
        } else {
          variableStore.set(key, resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "appendToArrayVariable": {
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const current = variableStore.get(key);
        const values = Array.isArray(current) ? [...current] : [];
        values.push(resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        variableStore.set(key, values);
        return { next: nextFlow(blueprint, node) };
      }
      case "setLocalVariable": {
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const scopedKey = `__local:${key}`;
        if (Object.prototype.hasOwnProperty.call(node.inputs || {}, "delta")) {
          variableStore.delta(scopedKey, resolveInput(blueprint, node, "delta", variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway));
        } else {
          variableStore.set(scopedKey, resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "setLanguage": {
        if (!runtimeGateway?.setLanguage) throw new Error(t("error.70e51cb62f01"));
        runtimeGateway.setLanguage(resolveInput(blueprint, node, "language", variableStore, "", undefined, pvGateway, dbGateway, runtimeGateway));
        return { next: nextFlow(blueprint, node) };
      }
      case "branch": {
        const condition = Boolean(resolveInput(blueprint, node, "condition", variableStore, false, undefined, pvGateway, dbGateway, runtimeGateway));
        return { next: nextFlow(blueprint, node, condition ? "true" : "false") };
      }
      case "blockUntil": {
        if (node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, "condition")) {
          const condition = Boolean(resolveInput(blueprint, node, "condition", variableStore, false, undefined, pvGateway, dbGateway, runtimeGateway));
          if (condition) return { next: nextFlow(blueprint, node) };
          return { wait: true };
        }
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const expected = resolveInput(blueprint, node, "equals", variableStore, true, undefined, pvGateway, dbGateway, runtimeGateway);
        if (variableStore.get(key) === expected) return { next: nextFlow(blueprint, node) };
        return { wait: true };
      }

      case "openWindow": {
        const skip = Boolean(resolveInput(blueprint, node, "skip", variableStore, false, undefined, pvGateway, dbGateway, runtimeGateway));
        const windowId = resolveInput(blueprint, node, "windowId", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        if (!skip) windowGateway(windowId, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "closeWindow": {
        const windowId = resolveInput(blueprint, node, "windowId", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        windowGateway(windowId, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "addWindowComponent": {
        if (!apiGateway?.call) throw new Error(t("error.cbac236a53f6"));
        const publicVariableId = resolveInput(blueprint, node, "publicVariableId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway);
        const rawProperties = node.inputs?.properties;
        const componentProperties = rawProperties && typeof rawProperties === "object" && !Array.isArray(rawProperties) && !Object.prototype.hasOwnProperty.call(rawProperties, "nodeId") && !Object.prototype.hasOwnProperty.call(rawProperties, "variable")
          ? structuredClone(rawProperties)
          : resolveInput(blueprint, node, "properties", variableStore, {}, undefined, pvGateway, dbGateway, runtimeGateway);
        const result = apiGateway.call("window.addComponent", {
          windowId: resolveInput(blueprint, node, "windowId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway),
          parentId: resolveInput(blueprint, node, "parentId", variableStore, "root", undefined, pvGateway, dbGateway, runtimeGateway),
          componentId: resolveInput(blueprint, node, "componentId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway),
          componentType: resolveInput(blueprint, node, "componentType", variableStore, "container", undefined, pvGateway, dbGateway, runtimeGateway),
          publicVariableId,
          maxCount: resolveInput(blueprint, node, "maxCount", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway),
          properties: {
            ...componentProperties,
            ...Object.fromEntries(["x", "y", "width", "height", "text", "enabled"].map((key) => [key, resolveInput(blueprint, node, key, variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway)]).filter(([, value]) => value !== undefined)),
          },
          events: Object.fromEntries(["onCreate", "onClick", "onChange", "onFocus", "onBlur", "onDestroy"].map((eventName) => {
            const target = node.next?.[eventName]?.nodeId;
            return [eventName, target ? { ...blueprint, startNodeId: target } : node.events?.[eventName]];
          }).filter(([, event]) => event)),
        });
        if (result?.componentId && publicVariableId != null && pvGateway) pvGateway.set(publicVariableId, result.componentId);
        variableStore.set(`__nodeResult:${node.id}:componentId`, result?.componentId ?? null);
        const resultVariable = resolveInput(blueprint, node, "resultVariable", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway);
        if (resultVariable) variableStore.set(resultVariable, result?.componentId ?? null);
        return { next: nextFlow(blueprint, node, "onCreate") || nextFlow(blueprint, node) };
      }
      case "removeWindowComponent": {
        if (!apiGateway?.call) throw new Error(t("error.feb2a3be2247"));
        apiGateway.call("window.removeComponent", {
          windowId: resolveInput(blueprint, node, "windowId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway),
          componentId: resolveInput(blueprint, node, "componentId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway),
        });
        return { next: nextFlow(blueprint, node) };
      }
      case "getWindowLayout": {
        if (!apiGateway?.call) throw new Error(t("error.a6702f0f6b54"));
        const result = apiGateway.call("window.getLayout", { windowId: resolveInput(blueprint, node, "windowId", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway) });
        const resultVariable = resolveInput(blueprint, node, "resultVariable", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway);
        if (resultVariable) variableStore.set(resultVariable, result);
        return { next: nextFlow(blueprint, node) };
      }
      case "runActivity":
      case "insertActivity": {
        const activityId = resolveInput(blueprint, node, "activityId", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const queueId = resolveInput(blueprint, node, "queue", variableStore, resolveInput(blueprint, node, "queueId", variableStore, "main", undefined, pvGateway, dbGateway, runtimeGateway), undefined, pvGateway, dbGateway, runtimeGateway);
        const payload = resolveInput(blueprint, node, "payload", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway);
        activityGateway(activityId, queueId, instance, node, payload);
        return { next: nextFlow(blueprint, node) };
      }


      case "segmentBranch": {
        const value = Number(resolveInput(blueprint, node, "value", variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway));
        const count = Math.max(1, Math.min(32, Math.floor(Number(resolveInput(blueprint, node, "branchCount", variableStore, 1, undefined, pvGateway, dbGateway, runtimeGateway)))));
        const boundaries = Array.from({ length: count + 1 }, (_, index) => Number(resolveInput(blueprint, node, `boundary${index}`, variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway)));
        const index = boundaries.findIndex((upper, boundaryIndex) => value <= upper && value > boundaries[boundaryIndex + 1]);
        return { next: nextFlow(blueprint, node, index < 0 ? "default" : `segment${index}`) };
      }
      case "emitEvent": {
        const eventName = resolveInput(blueprint, node, "eventName", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const payload = resolveInput(blueprint, node, "payload", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        eventGateway(eventName, payload, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "callApi": {
        if (!apiGateway?.call) throw new Error(t("error.a389d5090bf1"));
        const apiId = resolveInput(blueprint, node, "apiId", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const payload = resolveInput(blueprint, node, "payload", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway);
        const result = apiGateway.call(apiId, payload, instance, node);
        const resultVariable = resolveInput(blueprint, node, "resultVariable", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        if (resultVariable) variableStore.set(resultVariable, result);
        return { next: nextFlow(blueprint, node) };
      }
      case "createRecord":
      case "getRecord":
      case "updateRecord":
      case "deleteRecord":
      case "findRecords":
      case "countRecords": {
        if (!dbGateway) throw new Error(`Node ${node.type} requires a dbGateway`);
        const databaseId = resolveInput(blueprint, node, "databaseId", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const resultVariable = resolveInput(blueprint, node, "resultVariable", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        let result;
        if (node.type === "createRecord") {
          result = dbGateway.createRecord(databaseId, resolveInput(blueprint, node, "data", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        } else if (node.type === "getRecord") {
          result = dbGateway.getRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        } else if (node.type === "updateRecord") {
          result = dbGateway.updateRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway), resolveInput(blueprint, node, "patch", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        } else if (node.type === "deleteRecord") {
          result = dbGateway.deleteRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        } else if (node.type === "findRecords") {
          result = dbGateway.findRecords(databaseId, resolveInput(blueprint, node, "query", variableStore, {}, undefined, pvGateway, dbGateway, runtimeGateway));
        } else {
          result = dbGateway.countRecords(databaseId, resolveInput(blueprint, node, "query", variableStore, {}, undefined, pvGateway, dbGateway, runtimeGateway));
        }
        if (resultVariable) variableStore.set(resultVariable, result);
        return { next: nextFlow(blueprint, node) };
      }
      case "applyPublicVariableEffect": {
        if (!pvGateway) throw new Error(`Node ${node.type} requires a pvGateway`);
        const id = resolveInput(blueprint, node, "id", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const inputs = node.inputs || {};
        if (Object.prototype.hasOwnProperty.call(inputs, "delta")) {
          pvGateway.increment(id, resolveInput(blueprint, node, "delta", variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway));
        } else if (Object.prototype.hasOwnProperty.call(inputs, "toggle")) {
          pvGateway.toggle(id);
        } else if (Object.prototype.hasOwnProperty.call(inputs, "setObjectRef")) {
          pvGateway.setObjectRef(id, resolveInput(blueprint, node, "setObjectRef", variableStore, null, undefined, pvGateway, dbGateway, runtimeGateway));
        } else {
          pvGateway.set(id, resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "markEventState": {
        if (!eventStateGateway && !onboardingGateway) throw new Error(`Node ${node.type} requires an eventStateGateway`);
        (eventStateGateway || onboardingGateway).mark(resolveInput(blueprint, node, "id", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway));
        return { next: nextFlow(blueprint, node) };
      }

      case "text": {
        const continueKey = resolveInput(blueprint, node, "continueKey", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const payload = {
          instanceId: instance.instanceId,
          speaker: resolveInput(blueprint, node, "speaker", variableStore, "", undefined, pvGateway, dbGateway, runtimeGateway),
          text: resolveInput(blueprint, node, "text", variableStore, "", undefined, pvGateway, dbGateway, runtimeGateway),
          displayTo: resolveInput(blueprint, node, "displayTo", variableStore, "default", undefined, pvGateway, dbGateway, runtimeGateway),
          keywordIds: resolveInput(blueprint, node, "keywordIds", variableStore, [], undefined, pvGateway, dbGateway, runtimeGateway),
          continueKey: continueKey || null,
        };
        lastDialogueDisplayTo = payload.displayTo || lastDialogueDisplayTo;
        instance.transcript = Array.isArray(instance.transcript) ? instance.transcript : [];
        instance.transcript.push({ type: "text", ...payload, continueKey: null });
        /* DEV-TOOLS:START */
        console.log("[NG dialogue] ActivityRunner text node", { activityId: definition.id, nodeId: node.id, payload });
        /* DEV-TOOLS:END */
        eventGateway("display:text", payload, instance, node);
        if (continueKey && !variableStore.get(continueKey)) return { wait: true };
        if (continueKey) variableStore.set(continueKey, null);
        return { next: nextFlow(blueprint, node) };
      }
      case "choice": {
        const selectionKey = resolveInput(blueprint, node, "selectionKey", variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
        const optionCount = Number(resolveInput(blueprint, node, "optionCount", variableStore, 0, undefined, pvGateway, dbGateway, runtimeGateway)) || 0;
        const payload = {
          instanceId: instance.instanceId,
          options: resolveInput(blueprint, node, "options", variableStore, [], undefined, pvGateway, dbGateway, runtimeGateway),
          selectionKey,
          displayTo: resolveInput(blueprint, node, "displayTo", variableStore, "default", undefined, pvGateway, dbGateway, runtimeGateway),
        };
        lastDialogueDisplayTo = payload.displayTo || lastDialogueDisplayTo;
        instance.transcript = Array.isArray(instance.transcript) ? instance.transcript : [];
        instance.transcript.push({ type: "choice", ...payload });
        /* DEV-TOOLS:START */
        console.log("[NG dialogue] ActivityRunner choice node", { activityId: definition.id, nodeId: node.id, payload });
        /* DEV-TOOLS:END */
        eventGateway("display:choice", payload, instance, node);
        const selected = selectionKey ? variableStore.get(selectionKey) : undefined;
        if (selected === undefined || selected === null) return { wait: true };
        const index = Number(selected);
        if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
          throw new Error(`Node ${node.id} received an out-of-range choice selection: ${selected}`);
        }
        if (selectionKey) variableStore.set(selectionKey, null);
        return { next: nextFlow(blueprint, node, `option${index}`) };
      }
      default: {
        const customDefinition = getActivityNodeDefinition(node.type);
        if (!customDefinition?.custom || !customDefinition.blueprint) throw new Error(`Unhandled node type: ${node.type}`);
        const replaceParameters = (value) => {
          if (Array.isArray(value)) return value.map(replaceParameters);
          if (!value || typeof value !== "object") return value;
          if (Object.keys(value).length === 1 && typeof value.parameter === "string") {
            return resolveInput(blueprint, node, value.parameter, variableStore, undefined, undefined, pvGateway, dbGateway, runtimeGateway);
          }
          return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceParameters(child)]));
        };
        const nestedBlueprint = structuredClone(customDefinition.blueprint);
        for (const nestedNode of Object.values(nestedBlueprint.nodes || {})) {
          nestedNode.inputs = replaceParameters(nestedNode.inputs || {});
        }
        const childInstance = {
          instanceId: `${instance.instanceId}:custom:${node.id}`,
          status: "pending",
          currentNodeId: nestedBlueprint.startNodeId,
          executedNodeIds: [],
          waitingNodeId: null,
        };
        const childRunner = createActivityRunner({
          definition: { id: node.type, blueprint: nestedBlueprint },
          instance: childInstance,
          variableStore,
          eventBus,
          timeGateway,
          windowGateway,
          activityGateway,
          eventGateway,
          dbGateway,
          pvGateway,
          runtimeGateway,
          eventStateGateway,
          apiGateway,
          onCheckpoint: () => {},
          onComplete: () => {},
        });
        childRunner.start();
        if (childInstance.status !== "resolved") throw new Error(`Custom blueprint node ${node.type} entered a waiting state; reusable nodes must complete synchronously`);
        return { next: nextFlow(blueprint, node, childInstance.returnPort) || nextFlow(blueprint, node) };
      }
    }
  }

  // A blockUntil node may depend on the generic per-run variableStore, on a
  // typed public PublicVariableManager value, or (via a wired
  // publicVariableCondition fed by a value comparing against the current
  // game-clock time) on the GameClock advancing - so re-checks are woken by
  // any of these three generic engine events, never a domain-specific one.
  const WAIT_WAKE_EVENTS = ["variable:changed", "gameClock:changed"];

  function subscribeWait(node) {
    if (waitUnsubscribe) return;
    const unsubscribers = WAIT_WAKE_EVENTS.map((eventName) => eventBus.on(eventName, () => {
      if (cancelled || paused || instance.status === "resolved") return;
      const unsubscribe = waitUnsubscribe;
      if (!unsubscribe) return;
      waitUnsubscribe = null;
      unsubscribe();
      run(node.id);
    }));
    waitUnsubscribe = () => unsubscribers.forEach((fn) => fn());
  }

  function run(nodeId) {
    if (cancelled || paused || instance.status === "resolved") return;
    let current = nodeId;
    let guard = 0;
    let isResumeEntry = true;
    while (current && guard++ < MAX_STEPS) {
      const node = blueprint.nodes[current];
      if (!node) throw new Error(`Unknown flow node: ${current}`);
      instance.currentNodeId = current;
      instance.currentStep = { nodeId: current, type: node.type, status: "running" };

      // The already-executed skip only applies to the node we are resuming
      // *into* after a save/restore (e.g. currentNodeId pointed at a
      // consumeTime whose side effect already fired). Nodes reached later in
      // this same run — including loop bodies revisited many times — must
      // always execute, or a loop body's setVariable would only ever fire once.
      if (isResumeEntry && ONE_SHOT_NODE_TYPES.has(node.type) && instance.executedNodeIds.includes(current)) {
        isResumeEntry = false;
        current = nextFlow(blueprint, node);
        continue;
      }
      isResumeEntry = false;

      const result = execute(node);
      if (result?.wait) {
        instance.waitingNodeId = node.id;
        instance.currentStep = { nodeId: node.id, type: node.type, status: "waiting" };
        subscribeWait(node);
        onCheckpoint(instance);
        return;
      }
      if (result?.stop) return;

      markExecuted(node);
      instance.waitingNodeId = null;
      current = result?.next ?? null;
      instance.currentNodeId = current;
      instance.currentStep = current
        ? { nodeId: current, type: blueprint.nodes[current]?.type || null, status: "pending" }
        : null;
      onCheckpoint(instance);
    }
    if (guard >= MAX_STEPS) throw new Error(t("error.eba2b6ab7973"));
    finish("completed");
  }

  function start() {
    run(instance.currentNodeId || blueprint.startNodeId);
  }

  function pause() {
    if (instance.status === "resolved") return false;
    paused = true;
    instance.status = "paused";
    onCheckpoint(instance);
    return true;
  }

  function resume() {
    if (!paused) return false;
    paused = false;
    instance.status = "unresolved";
    onCheckpoint(instance);
    run(instance.currentNodeId);
    return true;
  }

  function cancel() {
    if (cancelled || instance.status === "resolved") return false;
    cancelled = true;
    if (waitUnsubscribe) {
      const unsubscribe = waitUnsubscribe;
      waitUnsubscribe = null;
      unsubscribe();
    }
    finish("cancelled");
    return true;
  }

  function setLocalVariable(key, value) {
    const normalized = String(key);
    localValues.set(normalized, structuredClone(value));
    instance.localVariables = Object.fromEntries(localValues);
    onCheckpoint(instance);
    return true;
  }

  function setCurrentNode(nodeId) {
    if (!blueprint.nodes[nodeId]) return false;
    instance.currentNodeId = nodeId;
    instance.currentStep = { nodeId, type: blueprint.nodes[nodeId].type, status: "pending" };
    onCheckpoint(instance);
    return true;
  }

  function setStatus(status) {
    if (!["unresolved", "paused", "failed", "resolved"].includes(status)) return false;
    if (status === "paused") { paused = true; instance.status = "paused"; }
    else if (status === "unresolved") { paused = false; instance.status = "unresolved"; }
    else instance.status = status;
    onCheckpoint(instance);
    return true;
  }

  return { start, pause, resume, cancel, setLocalVariable, setCurrentNode, setStatus, instance };
}

export default createActivityRunner;
