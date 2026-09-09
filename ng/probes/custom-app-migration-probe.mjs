import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PhaseBoundaryService from "../core/PhaseBoundaryService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const engine = JSON.parse(fs.readFileSync(path.join(root, "game-manifest.json"), "utf8"));
const icons = JSON.parse(fs.readFileSync(path.join(root, "desktop-icons.json"), "utf8"));
const migrated = [
  ["status", "状态与属性", "📊"],
  ["achievements", "成就", "🏆"],
  ["calendar", "日历", "📅"],
  ["locations", "去往位置", "🗺️"],
];
for (const [id, label, glyph] of migrated) {
  assert.ok(engine.windowManifest.includes(`${id}.json`), `${id} is in window manifest`);
  const definition = JSON.parse(fs.readFileSync(path.join(root, "windows", `${id}.json`), "utf8"));
  assert.equal(definition.id, id);
  assert.ok(definition.root, `${id} has a widget root`);
  const icon = icons.find((entry) => entry.iconId === id);
  assert.ok(icon, `${id} has a desktop icon`);
  assert.equal(icon.label, label);
  assert.equal(icon.glyph, glyph);
  assert.equal(icon.blueprintId, "desktop.open-window");
  assert.equal(icon.inputs.windowId, id);
}
const status = JSON.parse(fs.readFileSync(path.join(root, "windows", "status.json"), "utf8"));
assert.equal(status.root.children.find((node) => node.widgetId === "status-san").text.nodeId, "sanText");
const achievements = JSON.parse(fs.readFileSync(path.join(root, "windows", "achievements.json"), "utf8"));
assert.deepEqual(achievements.root.children.find((node) => node.widgetId === "achievements-list").items, { nodeId: "items", port: "value" });
const calendar = JSON.parse(fs.readFileSync(path.join(root, "windows", "calendar.json"), "utf8"));
assert.deepEqual(calendar.root.children.find((node) => node.widgetId === "calendar-grid").items, { variable: "calendar:days" });
const locations = JSON.parse(fs.readFileSync(path.join(root, "windows", "locations.json"), "utf8"));
for (const id of ["hospital", "restaurant", "seaside"]) {
  const button = locations.root.children.find((node) => node.widgetId === `location-${id}`);
  assert.equal(button.events.onClick.nodes.emit.inputs.eventName, "location:requested");
  assert.equal(button.events.onClick.nodes.emit.inputs.payload.locationId, id);
}
const phaseEvents = [];
const phaseService = new PhaseBoundaryService({
  state: { day: 1, phase: "day", duty: "off-duty", location: "dorm" },
  eventBus: { on: () => () => {}, emit: (...args) => phaseEvents.push(args) },
});
assert.equal(phaseService.requestLocation("hospital").ok, true);
assert.equal(phaseService.state.location, "hospital");
assert.equal(phaseEvents[0][0], "phase:changed");
console.log("custom-app-migration-probe: all four windows and desktop icons passed");
