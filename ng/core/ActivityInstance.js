export class ActivityInstance {
  constructor({ instanceId, definitionId, definitionVersion = 1, queueId = "main", inputs = {}, payload = {} } = {}) {
    if (!definitionId) throw new Error("Activity definitionId is required");
    this.instanceId = instanceId || `activity-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    this.definitionId = definitionId; this.definitionVersion = definitionVersion; this.queueId = queueId;
    this.inputs = structuredClone(inputs); this.payload = structuredClone(payload); this.currentNodeId = null; this.waiting = null; this.status = "unresolved"; this.result = null; this.transcript = []; this.terminalEmitted = false;
  }
  snapshot() { return structuredClone(this); }
  static restore(snapshot) { const instance = new ActivityInstance(snapshot); Object.assign(instance, structuredClone(snapshot)); return instance; }
  transition(status, result = null) { if (!["unresolved", "running", "blocked", "resolved", "failed", "cancelled"].includes(status)) throw new Error(`Invalid activity status: ${status}`); if (this.terminalEmitted) return false; this.status = status; if (["resolved", "failed", "cancelled"].includes(status)) { this.terminalEmitted = true; this.result = result; } return true; }
}
