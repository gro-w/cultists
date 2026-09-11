import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PhaseBoundaryService from "../../tools/ng-legacy-content/PhaseBoundaryService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const engine = JSON.parse(fs.readFileSync(path.join(root, "game-manifest.json"), "utf8"));
const icons = JSON.parse(fs.readFileSync(path.join(root, "desktop-icons.json"), "utf8"));
assert.equal(icons.filter((entry) => entry.inputs?.windowId === "his").length, 1);
assert.equal(icons.find((entry) => entry.inputs?.windowId === "his")?.label, "HIS 医疗系统");
assert.equal(icons.find((entry) => entry.inputs?.windowId === "his")?.order, 0);
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
assert.equal(achievements.root.children.find((node) => node.widgetId === "achievements-list").itemSecretField, "hidden");
assert.deepEqual(achievements.valueGraph.nodes.items.inputs.collectionId, "achievementItems");
assert.deepEqual(achievements.valueGraph.nodes.categories.inputs.collectionId, "achievementCategories");
assert.deepEqual(achievements.root.children[0].children.find((node) => node.widgetId === "achievements-category").options, { nodeId: "categories", port: "value" });
const calendar = JSON.parse(fs.readFileSync(path.join(root, "windows", "calendar.json"), "utf8"));
assert.deepEqual(calendar.root.children.find((node) => node.widgetId === "calendar-grid").items, { nodeId: "days", port: "value" });
assert.equal(calendar.valueGraph.nodes.days.inputs.collectionId, "calendarDays");
function findWidget(node, widgetId) {
  if (node?.widgetId === widgetId) return node;
  for (const child of node?.children || []) {
    const found = findWidget(child, widgetId);
    if (found) return found;
  }
  return null;
}

const calendarSummaryTitle = findWidget(calendar.root, "calendar-summary-title");
const calendarSummaryDetail = findWidget(calendar.root, "calendar-summary-detail");
assert.equal(calendarSummaryTitle.text, "实习日历");
assert.equal(calendarSummaryDetail.text, "共 7 天 · 休息日 1 天 · 夜班值班日 1 天");
const locations = JSON.parse(fs.readFileSync(path.join(root, "windows", "locations.json"), "utf8"));
for (const id of ["hospital", "restaurant", "seaside"]) {
  const button = locations.root.children.find((node) => node.widgetId === `location-${id}`);
  assert.equal(button.events.onClick.nodes.emit.inputs.eventName, "location:requested");
  assert.equal(button.events.onClick.nodes.emit.inputs.payload.locationId, id);
}
const notebook = JSON.parse(fs.readFileSync(path.join(root, "windows", "notebook.json"), "utf8"));
const notebookList = notebook.root.children.find((node) => node.widgetId === "notebook-list");
assert.equal(notebook.root.children.some((node) => node.widgetId === "notebook-sort"), false);
assert.deepEqual(notebook.valueGraph.nodes.spells.inputs.collectionId, "notebookSpells");
assert.equal(notebookList.itemGroupField, "groupTitle");
assert.deepEqual(notebook.root.children.find((node) => node.widgetId === "notebook-keyword-empty").emptyFor, { nodeId: "items", port: "value" });
assert.deepEqual(notebook.root.children.find((node) => node.widgetId === "notebook-spell-empty").emptyFor, { nodeId: "spells", port: "value" });
assert.equal(notebook.root.children.find((node) => node.widgetId === "notebook-spell-empty-hint").text, "在 0< SAN≤50 时使用可学习的书籍即可开始学习。");
const spellList = notebook.root.children.find((node) => node.widgetId === "notebook-spell-list");
assert.equal(spellList.visible.variable, "notebook:showSpells");
assert.equal(spellList.itemActions.find((action) => action.id === "cast").eventName, "onCast");
assert.equal(spellList.events.onCast.nodes.run.inputs.activityId, "spell-cast");
assert.ok(notebookList.itemActions.some((action) => action.eventName === "onDelete"));
assert.equal(notebookList.events.onItemClick.nodes.open.inputs.windowId, "chatgtp");
const chatgtp = JSON.parse(fs.readFileSync(path.join(root, "windows", "chatgtp.json"), "utf8"));
assert.ok(chatgtp.root);
const chatgtpLayout = chatgtp.root.children.find((node) => node.widgetId === "chatgtp-layout");
const chatgtpKeywords = chatgtpLayout.children.find((node) => node.widgetId === "chatgtp-keywords");
assert.ok(chatgtpKeywords.children.some((node) => node.widgetId === "chatgtp-keyword2-row"));
assert.equal(chatgtpKeywords.children.find((node) => node.widgetId === "chatgtp-keyword2-row").children[1].value.variable, "chatgtp:keyword2");
const phaseEvents = [];
const phaseService = new PhaseBoundaryService({
  state: { day: 1, phase: "day", duty: "off-duty", location: "dorm" },
  eventBus: { on: () => () => {}, emit: (...args) => phaseEvents.push(args) },
});
assert.equal(phaseService.requestLocation("hospital").ok, true);
assert.equal(phaseService.state.location, "hospital");
assert.equal(phaseEvents[0][0], "phase:changed");
console.log("custom-app-migration-probe: migrated windows and desktop icons passed");
