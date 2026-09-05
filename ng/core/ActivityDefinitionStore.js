import { validateBlueprint } from "./ActivityValidator.js";

/**
 * ActivityDefinitionStore - single owner of Activity *definitions*
 * (id + blueprint), loaded from `ng/data/activities/*.json`. Mirrors
 * WindowDefinitionStore's read-only, fetch-once contract so no other
 * module scatters `fetch("data/activities/...")` calls.
 */
export class ActivityDefinitionStore {
  constructor() {
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
    const loaded = await Promise.all(
      activityIds.map(async (activityId) => {
        const response = await fetch(`${baseUrl}${activityId}.json`);
        if (!response.ok) throw new Error(`Failed to load activity definition "${activityId}": ${response.status}`);
        return response.json();
      }),
    );
    loaded.forEach((definition) => this.register(definition));
    return this.list();
  }
}

export default ActivityDefinitionStore;
