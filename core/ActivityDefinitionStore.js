import { validateBlueprint } from "./ActivityValidator.js";
import { DataLoader } from "./DataLoader.js";

/**
 * ActivityDefinitionStore - single owner of Activity *definitions*
 * (id + blueprint), loaded from `data/activities/*.json`. Mirrors
 * WindowDefinitionStore's read-only, fetch-once contract so no other
 * module scatters `fetch("data/activities/...")` calls.
 */
export class ActivityDefinitionStore {
  constructor(dataLoader = new DataLoader()) {
    this.dataLoader = dataLoader;
    this._definitions = new Map();
  }

  register(definition) {
    if (!definition || !definition.id) throw new Error("Activity definition requires an id");
    const validation = validateBlueprint(definition.blueprint);
    if (!validation.ok) throw new Error(`Invalid blueprint for activity "${definition.id}": ${validation.errors.join("；")}`);
    const registered = { ...definition, blueprint: validation.blueprint };
    this._definitions.set(definition.id, registered);
    return registered;
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  list() {
    return [...this._definitions.values()];
  }

  async loadManifest(activityIds, baseUrl = "data/activities/") {
    // Keep the legacy list-driven loading order. Promise.all makes the
    // browser parse and validate the complete corpus in one bootstrap burst.
    for (const entry of activityIds || []) {
      const activityId = typeof entry === "string" ? entry : entry.id;
      if (!activityId || this._definitions.has(activityId)) continue;
      const file = typeof entry === "string" ? `${activityId}.json` : entry.file;
      if (!file) continue;
      const definition = await this.dataLoader.loadJSON(`${baseUrl}${file}`);
      this.register(definition);
    }
    return this.list();
  }
}

export default ActivityDefinitionStore;
