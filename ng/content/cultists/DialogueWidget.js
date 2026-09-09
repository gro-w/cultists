import { DisplayReceiverRegistry } from "../../core/DisplayReceiverRegistry.js";

/**
 * Generic dialogue widget used by declarative custom windows. It owns only
 * presentation and the opaque dialogue event contract; activities remain the
 * sole owner of dialogue state and progression.
 */
export class DialogueWidget {
  constructor({ eventBus, variableStore, keywordManager, gameClock, displayReceiverRegistry, displayTo = "dialogue", displayAliases = [] } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.keywordManager = keywordManager;
    this.gameClock = gameClock;
    this.displayTo = String(displayTo || "dialogue").trim();
    this.displayAliases = (Array.isArray(displayAliases) ? displayAliases : [displayAliases])
      .map((target) => String(target || "").trim())
      .filter((target) => target && target !== this.displayTo);
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget constructed", { displayTo: this.displayTo, hasEventBus: Boolean(eventBus), hasRegistry: Boolean(displayReceiverRegistry) });
    /* DEV-TOOLS:END */
    this.registry = displayReceiverRegistry || new DisplayReceiverRegistry();
    this._buildDom();
    this._receiver = { handle: (payload) => {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] widget receiver handle", { displayTo: this.displayTo, payload, connected: this.el.isConnected });
      /* DEV-TOOLS:END */
      if (payload.type === "text") this._onText(payload);
      else if (payload.type === "choice") this._onChoice(payload);
    } };
    this._receiverUnsubscribers = [this.registry.register(this.displayTo, this._receiver)];
    this.displayAliases.forEach((target) => this._receiverUnsubscribers.push(this.registry.register(target, this._receiver)));
    this._unsubscribe = () => this._receiverUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this._eventUnsubscribe = this.eventBus?.on?.("dialogue:text", (payload) => {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] widget eventBus text", { displayTo: this.displayTo, payload, accepted: this._accepts(payload) });
      /* DEV-TOOLS:END */
      if (this._accepts(payload)) this._onText({ ...payload, type: "text" });
    });
    this._choiceEventUnsubscribe = this.eventBus?.on?.("dialogue:choice", (payload) => {
      /* DEV-TOOLS:START */
      console.log("[NG dialogue] widget eventBus choice", { displayTo: this.displayTo, payload, accepted: this._accepts(payload) });
      /* DEV-TOOLS:END */
      if (this._accepts(payload)) this._onChoice({ ...payload, type: "choice" });
    });
    this._completeEventUnsubscribe = this.eventBus?.on?.("dialogue:complete", (payload) => {
      if (this._accepts(payload)) this._onComplete(payload);
    });

  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-dialogue-view";
    this.el.innerHTML = '<div class="ng-dialogue-transcript"></div><div class="ng-dialogue-controls"></div>';
    this.transcriptEl = this.el.querySelector(".ng-dialogue-transcript");
    this.controlsEl = this.el.querySelector(".ng-dialogue-controls");
    this.transcriptEl.addEventListener("click", (event) => {
      const span = event.target.closest(".keyword-highlight");
      if (!span || !this.keywordManager?.collect) return;
      this.keywordManager.collect(span.dataset.keywordId, this.gameClock?.snapshot().day);
      span.classList.add("keyword-highlight-collected");
    });
  }

  reset() {
    this.transcriptEl.replaceChildren();
    this.controlsEl.replaceChildren();
    this._lastEventKey = null;
  }

  _accepts() {
    // The legacy working DialogueView subscribed to the opaque dialogue event
    // stream without hard-coding an application target. The generic dialogue
    // window is the active conversation surface, so target filtering here can
    // discard valid HIS/social lines before they reach the visible transcript.
    return true;
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
    if (!this._accepts(payload)) return;
    const eventKey = `text:${payload.instanceId || ""}:${payload.continueKey || ""}:${payload.text || ""}`;
    if (this._lastEventKey === eventKey) return;
    this._lastEventKey = eventKey;
    this._activeInstanceId = payload.instanceId || null;
    const line = document.createElement("p");
    line.className = "ng-dialogue-line";
    const speaker = document.createElement("span");
    speaker.className = "ng-dialogue-speaker";
    speaker.textContent = payload.speaker ? `${payload.speaker}：` : "";
    line.appendChild(speaker);
    const body = this.keywordManager?.renderHighlightedText
      ? this.keywordManager.renderHighlightedText(payload.text || "")
      : document.createTextNode(payload.text || "");
    if (typeof body === "string") line.insertAdjacentHTML("beforeend", body);
    else line.appendChild(body);
    this.transcriptEl.appendChild(line);
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget rendered text", { displayTo: this.displayTo, payload, transcriptChildren: this.transcriptEl.children.length, connected: this.el.isConnected });
    /* DEV-TOOLS:END */
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
    if (!this._accepts(payload)) return;
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
    /* DEV-TOOLS:START */
    console.log("[NG dialogue] widget rendered choice", { displayTo: this.displayTo, payload, optionCount: list.children.length, connected: this.el.isConnected });
    /* DEV-TOOLS:END */
  }

  _onComplete(payload) {
    if (payload?.instanceId && payload.instanceId !== this._activeInstanceId) return;
    this.controlsEl.replaceChildren();
  }

  destroy() {
    this._unsubscribe?.();
    this._eventUnsubscribe?.();
    this._choiceEventUnsubscribe?.();
    this._completeEventUnsubscribe?.();
  }
}

export default DialogueWidget;
