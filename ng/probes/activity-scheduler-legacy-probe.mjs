import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityScheduler } from "../scripts/legacy-ActivityScheduler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const loader = { loadJSON: async (file) => JSON.parse(await fs.readFile(path.join(root, file), "utf8")) };
const definitions = new ActivityDefinitionStore(loader);
const manifest = await loader.loadJSON("activity-manifest.json");
await definitions.loadManifest(manifest.activityIds, "activities/");
const calendar = await loader.loadJSON("activity-calendar.json");
const queues = new ActivityQueueRegistry();
queues.register("work");
queues.register("social");
const scheduler = new ActivityScheduler({ activityCalendar: calendar, activityDefinitionStore: definitions, queueRegistry: queues, context: {} });
const catalog = scheduler.load();
assert.ok(scheduler.slots.size > 0);
assert.ok(catalog.size > 0);
assert.ok(definitions.list().length > 0);
assert.ok(Array.isArray(scheduler.diagnostics));
console.log(`activity-scheduler probe: slots=${scheduler.slots.size} catalog=${catalog.size} definitions=${definitions.list().length} diagnostics=${scheduler.diagnostics.length}`);
