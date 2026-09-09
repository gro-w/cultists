import { evaluateValueOutput, resolveInput } from "./ActivityRunner.js";

/**
 * Evaluates content-declared Activity availability without knowing any game
 * domain. The prerequisite and expiry nodes are pure value nodes; this module
 * only supplies the runtime gateways already used by ActivityRunner.
 */
export function evaluateActivityAvailability(definition, context = {}) {
  if (!definition) return { ok: false, reason: "missing-definition" };
  const blueprint = definition.blueprint;
  const nodes = Object.values(blueprint?.nodes || {});
  const valueStore = context.variableStore;
  const pvGateway = context.publicVariableManager || context.pvGateway || null;
  const readNodeInput = (node, name, fallback) => resolveInput(blueprint, node, name, valueStore, fallback, new Set(), pvGateway);

  if (definition.condition && !context.evaluateCondition?.(definition.condition, context)) {
    return { ok: false, reason: "definition-condition" };
  }
  if (definition.day != null && context.gameClock?.day !== definition.day) {
    return { ok: false, reason: "day" };
  }

  const prerequisite = nodes.find((node) => node.type === "prerequisite");
  if (prerequisite) {
    let passed;
    try { passed = readNodeInput(prerequisite, "condition", false); } catch (error) {
      return { ok: false, reason: "prerequisite-error", error };
    }
    if (passed !== true) return { ok: false, reason: "prerequisite" };
  }

  const expiry = nodes.find((node) => node.type === "activityExpiry");
  if (expiry) {
    let expired;
    try { expired = readNodeInput(expiry, "expires", false); } catch (error) {
      return { ok: false, reason: "expiry-error", error };
    }
    if (expired === true) return { ok: false, reason: "expired" };
    const expiresAt = readNodeInput(expiry, "expiresAt", null);
    // Content blueprints use 0 as the explicit "no absolute expiry" value.
    // Treating it as day 1 00:00 makes every activity with the standard
    // activity-expiry node unavailable as soon as the clock advances.
    const absoluteExpiry = Number(expiresAt);
    if (expiresAt != null && Number.isFinite(absoluteExpiry) && absoluteExpiry > 0
      && currentTotalMinutes(context.gameClock) >= absoluteExpiry) {
      return { ok: false, reason: "expired" };
    }
  }

  return { ok: true, reason: null };
}

function currentTotalMinutes(gameClock) {
  const snapshot = gameClock?.snapshot?.() || gameClock || {};
  return (Number(snapshot.day || 1) - 1) * 1440 + Number(snapshot.minutes || 0);
}

/** Evaluates one pure value output for tools and deterministic probes. */
export function evaluateActivityValue(definition, nodeId, portName, context = {}) {
  return evaluateValueOutput(
    definition.blueprint,
    nodeId,
    portName,
    context.variableStore,
    new Set(),
    context.publicVariableManager || context.pvGateway || null,
  );
}

export default evaluateActivityAvailability;
