import { DisplayReceiverRegistry } from "./DisplayReceiverRegistry.js";

/**
 * Generic text/choice display widget. It knows only the opaque display
 * receiver protocol; content packages decide the target and payload fields.
 */
export class TextChoiceWidget {
  constructor({ eventBus, variableStore, displayReceiverRegistry, displayTo = "default", displayAliases = [] } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.displayTo = String(displayTo || "default").trim();
    this.displayAliases = (Array.isArray(displayAliases) ? displayAliases : [displayAliases])
      .map((target) => String(target || "").trim())
      .filter((target) => target && target !== this.displayTo);
    this.registry = displayReceiverRegistry || new DisplayReceiverRegistry();
    this._buildDom();
    this._receiver = { handle: (payload) => this._handle(payload) };
    this._receiverUnsubscribers = [this.registry.register(this.displayTo, this._receiver)];
    this.displayAliases.forEach((target) => this._receiverUnsubscribers.push(this.registry.register(target, this._receiver)));
    this._unsubscribe = () => this._receiverUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this._eventUnsubscribe = this.eventBus?.on?.("display:text", (payload) => this._handle({ ...payload, type: "text" }));
    this._choiceEventUnsubscribe = this.eventBus?.on?.("display:choice", (payload) => this._handle({ ...payload, type: "choice" }));
    this._mediaEventUnsubscribe = this.eventBus?.on?.("display:media", (payload) => this._handle({ ...payload, type: "media" }));
    this._mediaEndEventUnsubscribe = this.eventBus?.on?.("display:media-end", (payload) => this._handle({ ...payload, type: "media-end" }));
    this._completeEventUnsubscribe = this.eventBus?.on?.("display:complete", (payload) => this._onComplete(payload));
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-dialogue-view";
    this.el.innerHTML = '<div class="ng-dialogue-transcript"></div><div class="ng-dialogue-controls"></div>';
    this.transcriptEl = this.el.querySelector(".ng-dialogue-transcript");
    this.controlsEl = this.el.querySelector(".ng-dialogue-controls");
  }

  _accepts(payload = {}) {
    const target = String(payload.displayTo || "default").trim() || "default";
    return target === this.displayTo || this.displayAliases.includes(target);
  }

  _handle(payload = {}) {
    if (!this._accepts(payload)) return;
    if (payload.type === "text") this._onText(payload);
    else if (payload.type === "choice") this._onChoice(payload);
    else if (payload.type === "media") this._onMedia(payload);
    else if (payload.type === "media-end") this._onMediaEnd();
  }

  reset() {
    this.transcriptEl.replaceChildren();
    this.controlsEl.replaceChildren();
    this._lastEventKey = null;
  }

  addAliases(aliases = []) {
    for (const target of (Array.isArray(aliases) ? aliases : [aliases])) {
      const alias = String(target || "").trim();
      if (!alias || alias === this.displayTo || this.displayAliases.includes(alias)) continue;
      this.displayAliases.push(alias);
      this._receiverUnsubscribers.push(this.registry.register(alias, this._receiver));
    }
  }

  _onText(payload) {
    const eventKey = `text:${payload.instanceId || ""}:${payload.continueKey || ""}:${payload.text || ""}`;
    if (this._lastEventKey === eventKey) return;
    this._lastEventKey = eventKey;
    this._activeInstanceId = payload.instanceId || null;
    const line = document.createElement("p");
    line.className = "ng-dialogue-line";
    if (payload.speaker) {
      const speaker = document.createElement("span");
      speaker.className = "ng-dialogue-speaker";
      speaker.textContent = `${payload.speaker}：`;
      line.appendChild(speaker);
    }
    line.appendChild(document.createTextNode(payload.text || ""));
    this.transcriptEl.appendChild(line);
    this.controlsEl.replaceChildren();
    if (payload.continueKey) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-continue";
      button.textContent = "继续";
      button.addEventListener("click", () => this.variableStore?.set(payload.continueKey, true));
      this.controlsEl.appendChild(button);
    }
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  _onChoice(payload) {
    const eventKey = `choice:${payload.instanceId || ""}:${payload.selectionKey || ""}:${JSON.stringify(payload.options || [])}`;
    if (this._lastEventKey === eventKey) return;
    this._lastEventKey = eventKey;
    this._activeInstanceId = payload.instanceId || this._activeInstanceId;
    this.controlsEl.replaceChildren();
    const list = document.createElement("div");
    list.className = "ng-dialogue-choices";
    (payload.options || []).forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-choice";
      button.textContent = option?.label ?? String(option);
      button.addEventListener("click", () => this.variableStore?.set(payload.selectionKey, index));
      list.appendChild(button);
    });
    this.controlsEl.appendChild(list);
  }

  _onMedia(payload = {}) {
    this.el.querySelector(".ng-dialogue-media")?.remove();
    const media = document.createElement(payload.imageData ? "img" : "div");
    media.className = "ng-dialogue-media";
    if (payload.imageData) {
      media.src = payload.imageData;
      media.alt = payload.cgId || payload.imageId || payload.mediaKind || "media";
    } else {
      media.textContent = `媒体：${payload.cgId || payload.imageId || ""}`;
    }
    this.el.insertBefore(media, this.transcriptEl);
  }

  _onMediaEnd() {
    this.el.querySelector(".ng-dialogue-media")?.remove();
  }

  _onComplete(payload = {}) {
    if (!this._accepts(payload)) return;
    if (payload.instanceId && payload.instanceId !== this._activeInstanceId) return;
    this.controlsEl.replaceChildren();
  }

  destroy() {
    this._unsubscribe?.();
    this._eventUnsubscribe?.();
    this._choiceEventUnsubscribe?.();
    this._mediaEventUnsubscribe?.();
    this._mediaEndEventUnsubscribe?.();
    this._completeEventUnsubscribe?.();
  }
}

export default TextChoiceWidget;
