/**
 * Compatibility boundary for blueprint events produced by the legacy-content
 * converter.  The converter deliberately keeps these events data-driven; this
 * module is the only place where their old names are mapped to NG domain
 * services.  It is intentionally small and side-effect explicit so missing
 * legacy event support cannot silently become a no-op.
 */
export class LegacyContentEventGateway {
  constructor({ eventBus, itemManager, spellManager, mediaStateManager, selectionSubmissionManager, medicalCaseManager } = {}) {
    this.eventBus = eventBus;
    this.itemManager = itemManager;
    this.spellManager = spellManager;
    this.mediaStateManager = mediaStateManager;
    this.selectionSubmissionManager = selectionSubmissionManager;
    this.medicalCaseManager = medicalCaseManager;
    this.handlers = new Map([
      ["content:showCg", (payload) => this.showCg(payload)],
      ["content:endCg", (payload) => this.endCg(payload)],
      ["content:showImage", (payload) => this.showImage(payload)],
      ["content:inventoryOperation", (payload) => this.inventoryOperation(payload)],
      ["content:spellCast", (payload) => this.spellCast(payload)],
      ["content:spellEffect", (payload) => this.spellEffect(payload)],
      ["content:hisRefresh", (payload) => this.hisRefresh(payload)],
      ["content:hisSelectPatient", (payload) => this.hisSelectPatient(payload)],
      ["content:hisRenderDiagnosis", (payload) => this.hisRenderDiagnosis(payload)],
      ["content:hisRenderPrescription", (payload) => this.hisRenderPrescription(payload)],
      ["content:hisSubmit", (payload) => this.hisSubmit(payload)],
    ]);
  }

  connect() {
    for (const [eventName, handler] of this.handlers) this.eventBus.on(eventName, handler);
    return this;
  }

  _payload(payload) { return payload && typeof payload === "object" ? payload : {}; }

  showCg(payload) {
    const { cgId, ...rest } = this._payload(payload);
    if (!cgId) throw new Error("content:showCg requires cgId");
    return this.mediaStateManager.showCg(cgId, rest);
  }

  endCg(payload) {
    this.mediaStateManager.stopBgm();
    this.eventBus.emit("media:end-cg", this._payload(payload));
  }

  showImage(payload) {
    const value = this._payload(payload);
    const imageId = value.imageId || value.src || value.path;
    if (!imageId) throw new Error("content:showImage requires imageId, src, or path");
    return this.mediaStateManager.play(imageId, { kind: "image", ...value });
  }

  inventoryOperation(payload) {
    const { itemId, count = 0 } = this._payload(payload);
    if (!itemId || !Number.isInteger(Number(count))) throw new Error("content:inventoryOperation requires itemId and integer count");
    const amount = Number(count);
    const result = amount < 0 ? this.itemManager.remove(itemId, -amount) : this.itemManager.add(itemId, amount);
    this.eventBus.emit("content:inventoryOperation:applied", { itemId: String(itemId), count: amount, result });
    return result;
  }

  spellCast(payload) {
    const value = this._payload(payload);
    if (!value.spellId) throw new Error("content:spellCast requires spellId");
    const result = this.spellManager.cast(value.spellId, value);
    this.eventBus.emit("content:spellCast:applied", { ...value, result });
    return result;
  }

  spellEffect(payload) {
    const value = this._payload(payload);
    if (!value.spellId) throw new Error("content:spellEffect requires spellId");
    this.eventBus.emit("spell:effect", { ...value });
  }

  _session(payload) { return this._payload(payload).sessionId || "his"; }
  hisRefresh(payload) { this.eventBus.emit("his:refresh", { sessionId: this._session(payload), ...this._payload(payload) }); }
  hisSelectPatient(payload) {
    const value = this._payload(payload);
    if (value.patientId != null) this.selectionSubmissionManager.select(this._session(value), value.patientId);
    this.eventBus.emit("his:patient-selected", { sessionId: this._session(value), ...value });
  }
  hisRenderDiagnosis(payload) { this.eventBus.emit("his:diagnosis-render", { sessionId: this._session(payload), ...this._payload(payload) }); }
  hisRenderPrescription(payload) { this.eventBus.emit("his:prescription-render", { sessionId: this._session(payload), ...this._payload(payload) }); }
  hisSubmit(payload) {
    const value = this._payload(payload);
    if (this.medicalCaseManager && (value.patientId || value.patient) && value.diagnosis != null) {
      return this.medicalCaseManager.submit(value);
    }
    return this.selectionSubmissionManager.submit(this._session(value), value);
  }
}

export default LegacyContentEventGateway;