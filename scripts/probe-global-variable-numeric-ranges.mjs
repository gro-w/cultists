import assert from "node:assert/strict";
import fs from "node:fs";

const globals = JSON.parse(fs.readFileSync("data/zh-hans/global_variables.json", "utf8"));

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { globalVariableManager } = await import("../js/core/GlobalVariableManager.js");
globalVariableManager.replaceDefinitions(globals, { emit: false });

assert.equal(globalVariableManager.set(2, -100), -100);
assert.equal(globalVariableManager.set(2, 1000.126), 1000.13);
assert.equal(globalVariableManager.set(0, 255), 255);
assert.throws(() => globalVariableManager.set(0, 256), /0 to 255/);
assert.throws(() => globalVariableManager.set(0, -1), /0 to 255/);
assert.throws(() => globalVariableManager.set(0, 1.5), /integer number/);
assert.throws(() => globalVariableManager.set(2, Number.POSITIVE_INFINITY), /finite number/);
console.log("global variable numeric ranges probe: ok");
