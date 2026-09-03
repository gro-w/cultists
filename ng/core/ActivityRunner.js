/**
 * ActivityRunner - node-by-node interpreter for a single Activity
 * instance's Blueprint (plan §13 Phase 2). Kept generic: the only node
 * types understood here are the ones in ActivityNodeRegistry.js.
 *
 * Resume semantics: one-shot side-effecting nodes (`setVariable`,
 * `consumeTime`) are tracked in `instance.executedNodeIds` and skipped if
 * revisited after a save/restore mid-flow, exactly like the equivalent
 * "already executed" guard in the legacy engine's ActivityRunner. Decision
 * nodes (`branch`, `loop`, `blockUntil`) always re-evaluate so they pick up
 * `instance.loopState`/variable changes correctly on resume.
 */
const ONE_SHOT_NODE_TYPES = new Set(["setVariable", "consumeTime"]);
const MAX_STEPS = 1000;

function nextFlow(blueprint, node, port = "flowOut") {
  const connection = blueprint.connections.find((item) => item.fromNodeId === node.id && item.fromPort === port);
  return connection ? connection.toNodeId : null;
}

function resolveInput(node, name, variableStore, fallback) {
  const raw = node.inputs ? node.inputs[name] : undefined;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "variable" in raw) {
    return variableStore.get(raw.variable);
  }
  return raw === undefined ? fallback : raw;
}

export function createActivityRunner({
  definition,
  instance,
  variableStore,
  eventBus,
  timeGateway = () => {},
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
        const key = resolveInput(node, "key", variableStore);
        if (Object.prototype.hasOwnProperty.call(node.inputs || {}, "delta")) {
          variableStore.delta(key, resolveInput(node, "delta", variableStore, 0));
        } else {
          variableStore.set(key, resolveInput(node, "value", variableStore));
        }
        return { next: nextFlow(blueprint, node) };
      }
      case "branch": {
        const condition = Boolean(resolveInput(node, "condition", variableStore, false));
        return { next: nextFlow(blueprint, node, condition ? "true" : "false") };
      }
      case "loop": {
        const times = Number(resolveInput(node, "times", variableStore, 0));
        const count = instance.loopState[node.id] || 0;
        if (count < times) {
          instance.loopState[node.id] = count + 1;
          return { next: nextFlow(blueprint, node, "body") };
        }
        return { next: nextFlow(blueprint, node, "done") };
      }
      case "blockUntil": {
        const key = resolveInput(node, "key", variableStore);
        const expected = resolveInput(node, "equals", variableStore, true);
        if (variableStore.get(key) === expected) return { next: nextFlow(blueprint, node) };
        return { wait: true };
      }
      case "consumeTime": {
        const minutes = Number(resolveInput(node, "minutes", variableStore, 0));
        timeGateway(minutes, instance, node);
        return { next: nextFlow(blueprint, node) };
      }
      default:
        throw new Error(`Unhandled node type: ${node.type}`);
    }
  }

  function subscribeWait(node) {
    if (waitUnsubscribe) return;
    waitUnsubscribe = eventBus.on("variable:changed", () => {
      if (cancelled || paused || instance.status === "resolved") return;
      const unsubscribe = waitUnsubscribe;
      waitUnsubscribe = null;
      unsubscribe();
      run(node.id);
    });
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
