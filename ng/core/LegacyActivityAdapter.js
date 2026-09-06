import { validateBlueprint } from "./ActivityValidator.js";

function cleanInputs(inputs = {}) {
  return Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== undefined));
}

/** Converts the legacy Activity graph vocabulary at the migration boundary. */
export function convertLegacyBlueprint(legacyBlueprint, { synthesizeKey = (id, suffix) => `dlg:${id}:${suffix}` } = {}) {
  const blockedTypes = new Set();
  const nodes = {};
  for (const [id, node] of Object.entries(legacyBlueprint?.nodes || {})) {
    const input = node.inputs || {};
    let type = node.type;
    let inputs = input;
    if (type === "setGlobal") {
      type = "applyPublicVariableEffect";
      inputs = { ...input, id: input.variableId };
      delete inputs.variableId;
    } else if (type === "getGlobal") {
      type = "getPublicVariable";
      inputs = { ...input, id: input.variableId };
      delete inputs.variableId;
    } else if (type === "text") {
      inputs = { ...input, continueKey: synthesizeKey(id, "continue") };
    } else if (type === "choice") {
      inputs = {
        options: node.options || input.options || [],
        optionCount: Number(input.branchCount) || (node.options || []).length,
        selectionKey: synthesizeKey(id, "select"),
      };
    }
    const supported = new Set([
      "flowStart", "activityEnd", "consumeTime", "branch", "arithmetic",
      "prerequisite", "activityExpiry", "applyPublicVariableEffect", "getPublicVariable",
      "text", "choice", "getGameTime", "getActivityInstanceCount", "insertActivity",
      "statOperation", "randomBranch", "diceCheck", "ending",
    ]);
    if (!supported.has(type)) blockedTypes.add(node.type);
    else nodes[id] = { id, type, inputs: cleanInputs(inputs), x: node.x, y: node.y };
  }
  if (blockedTypes.size) return { ok: false, blueprint: legacyBlueprint, blockedTypes: [...blockedTypes], errors: [] };
  const candidate = { startNodeId: legacyBlueprint.startNodeId, nodes, connections: legacyBlueprint.connections || [] };
  const validation = validateBlueprint(candidate);
  return { ok: validation.ok, blueprint: validation.blueprint, blockedTypes: [], errors: validation.errors };
}

export default convertLegacyBlueprint;
