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
const ONE_SHOT_NODE_TYPES = new Set([
  "setVariable", "consumeTime", "openWindow", "runActivity", "emitEvent",
  "createRecord", "updateRecord", "deleteRecord", "applyPublicVariableEffect",
  "markOnboardingMilestone",
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
export function evaluateValueOutput(blueprint, nodeId, portName, variableStore, stack, pvGateway = null) {
  const key = `${nodeId}:${portName}`;
  if (stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
  const node = blueprint.nodes[nodeId];
  if (!node) throw new Error(`Unknown value node: ${nodeId}`);
  stack.add(key);
  const read = (name, fallback) => resolveInput(blueprint, node, name, variableStore, fallback, stack, pvGateway);
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
    case "getProperty": {
      const target = read("value");
      result = target == null ? undefined : target[read("key")];
      break;
    }
    case "arrayAppend": {
      const array = read("array");
      result = [...(Array.isArray(array) ? array : []), read("item")];
      break;
    }
    case "getPublicVariable": {
      if (!pvGateway) throw new Error("Node getPublicVariable requires a pvGateway");
      result = pvGateway.get(read("id"));
      break;
    }
    case "publicVariableCondition": {
      if (!pvGateway) throw new Error("Node publicVariableCondition requires a pvGateway");
      result = pvGateway.evaluateCondition({ id: read("id"), op: read("op", "eq"), value: read("value") });
      break;
    }
    default:
      throw new Error(`Node ${node.type} does not produce a value output`);
  }
  stack.delete(key);
  return result;
}

function applyArithmetic(operator, left, right) {
  switch (operator) {
    case "+": return Number(left) + Number(right);
    case "-": return Number(left) - Number(right);
    case "*": return Number(left) * Number(right);
    case "/": if (Number(right) === 0) throw new Error("Division by zero"); return Number(left) / Number(right);
    case "%": if (Number(right) === 0) throw new Error("Division by zero"); return Number(left) % Number(right);
    case "and": return Boolean(left) && Boolean(right);
    case "or": return Boolean(left) || Boolean(right);
    case "xor": return Boolean(left) !== Boolean(right);
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    case "=": return left === right;
    case "not": return !Boolean(left);
    // Generic entropy source (Phase 8 legacy content migration): ignores
    // both operands, returns a float in [0, 1). This — composed with
    // `branch`/comparison operators above — is enough to express the
    // legacy engine's `randomBranch`/`diceCheck` content as an ordinary
    // value/flow graph, with no dedicated "random" flow node needed.
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
function resolveDeep(blueprint, value, variableStore, stack, pvGateway) {
  if (Array.isArray(value)) return value.map((item) => resolveDeep(blueprint, item, variableStore, stack, pvGateway));
  if (value && typeof value === "object") {
    if ("nodeId" in value) return evaluateValueOutput(blueprint, value.nodeId, value.port || "value", variableStore, stack, pvGateway);
    if ("variable" in value) return variableStore.get(value.variable);
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = resolveDeep(blueprint, child, variableStore, stack, pvGateway);
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
export function resolveInput(blueprint, node, name, variableStore, fallback, stack = new Set(), pvGateway = null) {
  const raw = node.inputs ? node.inputs[name] : undefined;
  if (raw === undefined) return fallback;
  return resolveDeep(blueprint, raw, variableStore, stack, pvGateway);
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
  onboardingGateway = null,
  onCheckpoint = () => {},
  onComplete = () => {},
} = {}) {
  const blueprint = definition.blueprint;
  let cancelled = false;
  let paused = false;
  let waitUnsubscribe = null;

  function markExecuted(node) {
    if (!instance.executedNodeIds.includes(node.id)) instance.executedNodeIds.push(node.id);
  }

  function finish(reason) {
    if (instance.status === "resolved") return;
    instance.status = "resolved";
    instance.resolutionReason = reason;
    instance.waitingNodeId = null;
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
      case "setVariable": {
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway);
        if (Object.prototype.hasOwnProperty.call(node.inputs || {}, "delta")) {
          variableStore.delta(key, resolveInput(blueprint, node, "delta", variableStore, 0, undefined, pvGateway));
        } else {
          variableStore.set(key, resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "branch": {
        const condition = Boolean(resolveInput(blueprint, node, "condition", variableStore, false, undefined, pvGateway));
        return { next: nextFlow(blueprint, node, condition ? "true" : "false") };
      }
      case "blockUntil": {
        if (node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, "condition")) {
          const condition = Boolean(resolveInput(blueprint, node, "condition", variableStore, false, undefined, pvGateway));
          if (condition) return { next: nextFlow(blueprint, node) };
          return { wait: true };
        }
        const key = resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway);
        const expected = resolveInput(blueprint, node, "equals", variableStore, true, undefined, pvGateway);
        if (variableStore.get(key) === expected) return { next: nextFlow(blueprint, node) };
        return { wait: true };
      }
      case "consumeTime": {
        const minutes = Number(resolveInput(blueprint, node, "minutes", variableStore, 0, undefined, pvGateway));
        timeGateway(minutes, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "openWindow": {
        const windowId = resolveInput(blueprint, node, "windowId", variableStore, undefined, undefined, pvGateway);
        windowGateway(windowId, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "runActivity": {
        const activityId = resolveInput(blueprint, node, "activityId", variableStore, undefined, undefined, pvGateway);
        const queueId = resolveInput(blueprint, node, "queueId", variableStore, "main", undefined, pvGateway);
        activityGateway(activityId, queueId, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "emitEvent": {
        const eventName = resolveInput(blueprint, node, "eventName", variableStore, undefined, undefined, pvGateway);
        const payload = resolveInput(blueprint, node, "payload", variableStore, undefined, undefined, pvGateway);
        eventGateway(eventName, payload, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      case "createRecord":
      case "getRecord":
      case "updateRecord":
      case "deleteRecord":
      case "findRecords":
      case "countRecords": {
        if (!dbGateway) throw new Error(`Node ${node.type} requires a dbGateway`);
        const databaseId = resolveInput(blueprint, node, "databaseId", variableStore, undefined, undefined, pvGateway);
        const resultVariable = resolveInput(blueprint, node, "resultVariable", variableStore, undefined, undefined, pvGateway);
        let result;
        if (node.type === "createRecord") {
          result = dbGateway.createRecord(databaseId, resolveInput(blueprint, node, "data", variableStore, undefined, undefined, pvGateway));
        } else if (node.type === "getRecord") {
          result = dbGateway.getRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway));
        } else if (node.type === "updateRecord") {
          result = dbGateway.updateRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway), resolveInput(blueprint, node, "patch", variableStore, undefined, undefined, pvGateway));
        } else if (node.type === "deleteRecord") {
          result = dbGateway.deleteRecord(databaseId, resolveInput(blueprint, node, "key", variableStore, undefined, undefined, pvGateway));
        } else if (node.type === "findRecords") {
          result = dbGateway.findRecords(databaseId, resolveInput(blueprint, node, "query", variableStore, {}, undefined, pvGateway));
        } else {
          result = dbGateway.countRecords(databaseId, resolveInput(blueprint, node, "query", variableStore, {}, undefined, pvGateway));
        }
        if (resultVariable) variableStore.set(resultVariable, result);
        return { next: nextFlow(blueprint, node) };
      }
      case "applyPublicVariableEffect": {
        if (!pvGateway) throw new Error(`Node ${node.type} requires a pvGateway`);
        const id = resolveInput(blueprint, node, "id", variableStore, undefined, undefined, pvGateway);
        const inputs = node.inputs || {};
        if (Object.prototype.hasOwnProperty.call(inputs, "delta")) {
          pvGateway.increment(id, resolveInput(blueprint, node, "delta", variableStore, 0, undefined, pvGateway));
        } else if (Object.prototype.hasOwnProperty.call(inputs, "toggle")) {
          pvGateway.toggle(id);
        } else if (Object.prototype.hasOwnProperty.call(inputs, "setObjectRef")) {
          pvGateway.setObjectRef(id, resolveInput(blueprint, node, "setObjectRef", variableStore, null, undefined, pvGateway));
        } else {
          pvGateway.set(id, resolveInput(blueprint, node, "value", variableStore, undefined, undefined, pvGateway));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "markOnboardingMilestone": {
        if (!onboardingGateway) throw new Error(`Node ${node.type} requires an onboardingGateway`);
        onboardingGateway.markMilestone(resolveInput(blueprint, node, "id", variableStore, undefined, undefined, pvGateway));
        return { next: nextFlow(blueprint, node) };
      }
      case "text": {
        const continueKey = resolveInput(blueprint, node, "continueKey", variableStore, undefined, undefined, pvGateway);
        eventGateway("dialogue:text", {
          instanceId: instance.instanceId,
          speaker: resolveInput(blueprint, node, "speaker", variableStore, "", undefined, pvGateway),
          text: resolveInput(blueprint, node, "text", variableStore, "", undefined, pvGateway),
          displayTo: resolveInput(blueprint, node, "displayTo", variableStore, "default", undefined, pvGateway),
          keywordIds: resolveInput(blueprint, node, "keywordIds", variableStore, [], undefined, pvGateway),
          continueKey: continueKey || null,
        }, instance, node);
        if (continueKey && !variableStore.get(continueKey)) return { wait: true };
        if (continueKey) variableStore.set(continueKey, null);
        return { next: nextFlow(blueprint, node) };
      }
      case "choice": {
        const selectionKey = resolveInput(blueprint, node, "selectionKey", variableStore, undefined, undefined, pvGateway);
        const optionCount = Number(resolveInput(blueprint, node, "optionCount", variableStore, 0, undefined, pvGateway)) || 0;
        eventGateway("dialogue:choice", {
          instanceId: instance.instanceId,
          options: resolveInput(blueprint, node, "options", variableStore, [], undefined, pvGateway),
          selectionKey,
        }, instance, node);
        const selected = selectionKey ? variableStore.get(selectionKey) : undefined;
        if (selected === undefined || selected === null) return { wait: true };
        const index = Number(selected);
        if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
          throw new Error(`Node ${node.id} received an out-of-range choice selection: ${selected}`);
        }
        if (selectionKey) variableStore.set(selectionKey, null);
        return { next: nextFlow(blueprint, node, `option${index}`) };
      }
      default:
        throw new Error(`Unhandled node type: ${node.type}`);
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
        subscribeWait(node);
        onCheckpoint(instance);
        return;
      }
      if (result?.stop) return;

      markExecuted(node);
      instance.waitingNodeId = null;
      current = result?.next ?? null;
      instance.currentNodeId = current;
      onCheckpoint(instance);
    }
    if (guard >= MAX_STEPS) throw new Error("Activity flow exceeded the maximum step count");
    finish("completed");
  }

  function start() {
    run(instance.currentNodeId || blueprint.startNodeId);
  }

  function pause() {
    if (instance.status === "resolved") return false;
    paused = true;
    return true;
  }

  function resume() {
    if (!paused) return false;
    paused = false;
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

  return { start, pause, resume, cancel, instance };
}

export default createActivityRunner;
