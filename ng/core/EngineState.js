export class EngineState {
  constructor() { this.lifecycle = "loading"; this.gameTime = 0; this.initializationVersion = 0; }
  setLifecycle(value) { if (!["loading", "restoring", "activating", "ready"].includes(value)) throw new Error(`Invalid lifecycle: ${value}`); this.lifecycle = value; }
  snapshot() { return { lifecycle: this.lifecycle, gameTime: this.gameTime, initializationVersion: this.initializationVersion }; }
  restore(snapshot = {}) { this.gameTime = Number.isFinite(snapshot.gameTime) ? snapshot.gameTime : 0; this.initializationVersion = Number.isInteger(snapshot.initializationVersion) ? snapshot.initializationVersion : 0; this.lifecycle = "restoring"; }
}
