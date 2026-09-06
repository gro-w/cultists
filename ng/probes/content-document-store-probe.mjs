import assert from "node:assert/strict";
import { ContentDocumentStore } from "../core/ContentDocumentStore.js";

const values = new Map([
  ["manifest.json", { documents: [{ id: "items", file: "items.json", sourceFile: "data/zh-hans/items.json" }] }],
  ["items.json", [{ id: "lamp", name: "Lamp" }]],
]);
const loader = { loadJSON: async (file) => values.get(file) };
const store = new ContentDocumentStore(loader);
await store.loadManifest("manifest.json");
assert.deepEqual(store.get("items").document, [{ id: "lamp", name: "Lamp" }]);
const draft = store.get("items").document;
draft[0].name = "Changed";
assert.equal(store.get("items").document[0].name, "Lamp");
store.replace("items", draft);
assert.equal(store.get("items").document[0].name, "Changed");
assert.deepEqual(store.toJSON(), { items: [{ id: "lamp", name: "Changed" }] });
console.log("content-document-store probe: ok");
