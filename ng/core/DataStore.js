export class DataStore {
  constructor(base = "./data/") { this.base = base; }
  async loadJSON(file) {
    const response = await fetch(`${this.base}${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load ${file}: ${response.status}`);
    return response.json();
  }
}
