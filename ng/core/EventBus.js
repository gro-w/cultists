export class EventBus {
  #listeners = new Map();
  on(name, listener) {
    if (!this.#listeners.has(name)) this.#listeners.set(name, new Set());
    this.#listeners.get(name).add(listener);
    return () => this.#listeners.get(name)?.delete(listener);
  }
  emit(name, payload = {}) {
    for (const listener of this.#listeners.get(name) || []) listener(payload);
  }
}
