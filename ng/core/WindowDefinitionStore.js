/**
 * WindowDefinitionStore - single owner of window *definitions* (static
 * content describing a window's default geometry and body), loaded from
 * `ng/data/windows/*.json`. Runtime open windows and their live geometry are
 * owned by WindowManager instead; this store never mutates once loaded.
 *
 * All JSON reads for window definitions must go through this store so no
 * other module scatters `fetch("data/windows/...")` calls (plan §2.1).
 */
export class WindowDefinitionStore {
  constructor() {
    this._definitions = new Map();
  }

  /** Register a definition object (id, title, width, height, body, ...). */
  register(definition) {
    if (!definition || !definition.id) {
      throw new Error("Window definition requires an id");
    }
    this._definitions.set(definition.id, definition);
    return definition;
  }

  get(id) {
    return this._definitions.get(id) || null;
  }

  list() {
    return [...this._definitions.values()];
  }

  /** Removes a definition (plan follow-up: "自定义窗口管理器也可以+-按钮"). */
  unregister(id) {
    return this._definitions.delete(id);
  }

  /**
   * Load every `*.json` file listed in `manifest` (array of file names)
   * from `baseUrl` (default "data/windows/") and register each as a window
   * definition keyed by its own `id` field.
   */
  async loadManifest(manifest, baseUrl = "data/windows/") {
    const loaded = await Promise.all(
      manifest.map(async (fileName) => {
        const response = await fetch(`${baseUrl}${fileName}`);
        if (!response.ok) {
          throw new Error(`Failed to load window definition "${fileName}": ${response.status}`);
        }
        return response.json();
      }),
    );
    loaded.forEach((definition) => this.register(definition));
    return this.list();
  }
}

export default WindowDefinitionStore;
