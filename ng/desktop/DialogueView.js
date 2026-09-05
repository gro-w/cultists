/**
 * DialogueView - a generic (plan §15 风险 F: no his-app/social-app/item
 * specific logic) player-facing renderer for the `text`/`choice` Activity
 * nodes' `dialogue:text`/`dialogue:choice` events (see
 * `ActivityRunner.js`). It only understands the opaque event payload
 * shape (`speaker`/`text`/`continueKey`, `options`/`selectionKey`) - the
 * same contract any future window could subscribe to independently; this
 * is simply the first (and, for now, only) subscriber.
 *
 * Every line/choice event carries the emitting Activity instance's
 * `instanceId` so multiple Activities running concurrently on different
 * queues don't interleave into one transcript: this view only renders
 * events for the instance it is currently "following" (the most recent
 * instance to emit, until the window is reset).
 */
export class DialogueView {
  constructor({ eventBus, variableStore } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.instanceId = null;
    this._buildDom();
    this._unsubscribers = [
      eventBus.on("dialogue:text", (payload) => this._onText(payload)),
      eventBus.on("dialogue:choice", (payload) => this._onChoice(payload)),
    ];
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-dialogue-view";
    el.innerHTML = `
      <div class="ng-dialogue-transcript"></div>
      <div class="ng-dialogue-controls"></div>
    `;
    this.el = el;
    this.transcriptEl = el.querySelector(".ng-dialogue-transcript");
    this.controlsEl = el.querySelector(".ng-dialogue-controls");
  }

  /** Clears the transcript and stops following whichever instance was previously shown, for a fresh Activity run. */
  reset() {
    this.instanceId = null;
    this.transcriptEl.innerHTML = "";
    this.controlsEl.innerHTML = "";
  }

  _onText(payload) {
    this.instanceId = payload.instanceId;
    const line = document.createElement("p");
    line.className = "ng-dialogue-line";
    const speaker = payload.speaker ? `<span class="ng-dialogue-speaker">${payload.speaker}：</span>` : "";
    line.innerHTML = `${speaker}${this._escape(payload.text || "")}`;
    this.transcriptEl.appendChild(line);
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;

    this.controlsEl.innerHTML = "";
    if (payload.continueKey) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-continue";
      button.textContent = "继续";
      button.addEventListener("click", () => this.variableStore.set(payload.continueKey, true));
      this.controlsEl.appendChild(button);
    }
  }

  _onChoice(payload) {
    this.instanceId = payload.instanceId;
    this.controlsEl.innerHTML = "";
    const list = document.createElement("div");
    list.className = "ng-dialogue-choices";
    (payload.options || []).forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-dialogue-choice";
      button.textContent = option?.label ?? String(option);
      button.addEventListener("click", () => this.variableStore.set(payload.selectionKey, index));
      list.appendChild(button);
    });
    this.controlsEl.appendChild(list);
  }

  _escape(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    this._unsubscribers.forEach((fn) => fn());
  }
}

export default DialogueView;
