import { parseCl2 } from "./Cl2Parser.js";

/** Decode CL2 payloads embedded in JSON window/item/content definitions. */
export function decodeCl2Blueprints(value, sourcePath = "<embedded>", blueprintKind = null) {
  if (Array.isArray(value)) return value.map((item, index) => decodeCl2Blueprints(item, `${sourcePath}[${index}]`, blueprintKind));
  if (!value || typeof value !== "object") return value;
  if (typeof value.cl2 === "string" && Object.keys(value).every((key) => key === "cl2")) {
    const result = parseCl2(value.cl2, { sourcePath, validate: false, blueprintKind });
    if (!result.ok) {
      const details = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("；");
      throw new Error(`Invalid embedded CL2 blueprint "${sourcePath}": ${details}`);
    }
    return result.graph;
  }
  const nestedBlueprintKind = (value.flowInputs || []).length
    ? "customFlow"
    : (value.valueOutputs || []).length ? "customValue" : null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    decodeCl2Blueprints(item, `${sourcePath}.${key}`, key === "blueprint" && nestedBlueprintKind ? nestedBlueprintKind : blueprintKind),
  ]));
}

export default decodeCl2Blueprints;
