import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { saveManager } = await import("../js/core/SaveManager.js");
const bytes = saveManager._encode();
assert.ok(bytes.length > 7);
saveManager._decode(bytes);
console.log("save round-trip: ok");
