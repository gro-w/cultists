export class SaveManager {
  constructor({ key = "cultists-ng-save", engineVersion = "0.1.0", state, variables, structures, queues, windows, eventBus } = {}) { this.key = key; this.engineVersion = engineVersion; this.state = state; this.variables = variables; this.structures = structures; this.queues = queues; this.windows = windows; this.eventBus = eventBus; }
  snapshot() { return { format: "cultists-ng-save", version: 1, engineVersion: this.engineVersion, createdAtGameTime: this.state.gameTime, state: { engine: this.state.snapshot(), variables: this.variables.snapshot(), databases: this.structures.snapshot(), queues: this.queues.snapshot(), windows: this.windows.snapshot() } }; }
  save() { const payload = this.snapshot(); localStorage.setItem(this.key, JSON.stringify(payload)); this.eventBus?.emit("save:written", { key: this.key }); return payload; }
  load() { const raw = localStorage.getItem(this.key); if (!raw) return false; const payload = JSON.parse(raw); if (payload.format !== "cultists-ng-save" || payload.version !== 1) throw new Error("Unsupported save format"); this.state.restore(payload.state.engine); this.variables.restore(payload.state.variables); this.structures.restore(payload.state.databases); this.queues.restore(payload.state.queues); this.eventBus?.emit("save:loaded", { key: this.key }); return payload; }
  clear() { localStorage.removeItem(this.key); }
}
