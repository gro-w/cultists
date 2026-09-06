function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * ContentDocumentStore keeps authored JSON documents intact when a legacy
 * domain has not yet been normalized into a typed database or Activity.
 * It is an engine-level document registry, not a game-domain manager: IDs,
 * file names, and document shapes come entirely from the manifest.
 */
export class ContentDocumentStore {
  constructor(dataLoader) {
    if (!dataLoader) throw new Error("ContentDocumentStore requires a DataLoader");
    this.dataLoader = dataLoader;
    this.documents = new Map();
    this.manifest = null;
  }

  async loadManifest(manifestFile) {
    const manifest = await this.dataLoader.loadJSON(manifestFile);
    if (!Array.isArray(manifest?.documents)) throw new Error("Content manifest requires a documents array");
    this.manifest = clone(manifest);
    for (const entry of manifest.documents) {
      if (!entry?.id || !entry.file) throw new Error("Content manifest entries require id and file");
      const document = await this.dataLoader.loadJSON(entry.file);
      this.documents.set(entry.id, { ...clone(entry), document: clone(document) });
    }
    return this.list();
  }

  get(id) {
    const entry = this.documents.get(id);
    return entry ? clone(entry) : null;
  }

  list() {
    return [...this.documents.values()].map(clone);
  }

  replace(id, document) {
    const entry = this.documents.get(id);
    if (!entry) throw new Error(`Unknown content document: ${id}`);
    entry.document = clone(document);
    return this.get(id);
  }

  toJSON() {
    return Object.fromEntries([...this.documents].map(([id, entry]) => [id, clone(entry.document)]));
  }
}

export default ContentDocumentStore;
