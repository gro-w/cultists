import { normalizeBlueprint, validateBlueprint } from "./ActivityBlueprint.js";
import { ActivityValueEvaluator } from "./ActivityValueEvaluator.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { eventBus } from "./EventBus.js";
import { applyDialogueOnShow } from "./DialogueEffects.js";
import { spellManager } from "./SpellManager.js";
import { keywordManager } from "./KeywordManager.js";
import { displayReceiverManager } from "./DisplayReceiverManager.js";
import { activityEffectExecutor } from "./ActivityEffectExecutor.js";
import { activityQueueRegistry } from "./ActivityQueueRegistry.js";
import { ACTIVITY_EVENTS } from "./ActivityEvents.js";

const STATUS = Object.freeze({ nonexistent: 0, unresolved: 1, resolved: 2, pending: 1, completed: 2 });

function inputValue(blueprint, node, name, evaluator, fallback) {
  const connection = (blueprint.connections || []).find((item) => item.toNodeId === node.id && item.toPort === name);
  if (connection) return evaluator.evaluateNode(connection.fromNodeId, connection.fromPort);
  const value = node.inputs?.[name];
  if (value && typeof value === "object" && value.nodeId) return evaluator.evaluateNode(value.nodeId, value.port || "value");
  return value === undefined ? fallback : value;
}

function nextFlow(blueprint, node, port = "flowOut") {
  const connection = (blueprint.connections || []).find((item) => item.fromNodeId === node.id && item.fromPort === port);
  return connection?.toNodeId || node.next || null;
}

function nextDynamicFlow(blueprint, node, port) {
  const selected = (blueprint.connections || []).find((item) => item.fromNodeId === node.id && item.fromPort === port);
  if (selected) return selected.toNodeId;
  const fallback = (blueprint.connections || []).find((item) => item.fromNodeId === node.id && item.fromPort === "default");
  return fallback?.toNodeId || null;
}

export class ActivityRunner {
  constructor({ definition, instance, appendLine = () => {}, optionsEl = null, onComplete = () => {}, onCheckpoint = () => {}, onItemInspection = () => {}, appId = "activity", queueId = null, readOnly = false, random = Math.random, choiceClassName = "", onChoiceAvailable = () => {}, onChoiceSelected = () => {}, decorateChoice = () => {}, effects = activityEffectExecutor } = {}) {
    this.definition = definition || {};
    this.instance = instance || { status: "unresolved", transcript: [] };
    if (this.instance.status === "pending" || this.instance.status === "completed") this.instance.status = this.instance.status === "completed" ? "resolved" : "unresolved";
    if (!Array.isArray(this.instance.executedNodeIds)) this.instance.executedNodeIds = [];
    this.blueprint = normalizeBlueprint(this.definition.blueprint || this.definition);
    this.random = random;
    this.appendLine = appendLine;
    this.optionsEl = optionsEl;
    this.onComplete = onComplete;
    this.onCheckpoint = onCheckpoint;
    this.onItemInspection = onItemInspection;
    this.appId = appId;
    this.queueId = queueId;
    this.choiceClassName = choiceClassName;
    this.onChoiceAvailable = onChoiceAvailable;
    this.onChoiceSelected = onChoiceSelected;
    this.decorateChoice = decorateChoice;
    this.effects = effects;
    this.readOnly = readOnly || this.instance.status === "resolved";
    this._waitUntilUnsubscribers = [];
    this._waitUntilEvaluating = false;
    this._cancelled = false;
    this.evaluator = new ActivityValueEvaluator(this.blueprint, {
      activityStatus: (instanceId) => this._activityStatus(instanceId),
      activityInstanceCount: (activityId) => this._activityInstanceCount(activityId),
    });
    const validation = validateBlueprint(this.blueprint);
    if (!validation.ok) throw new Error(validation.errors.join("；"));
  }

  start(nodeId = this.instance.currentNodeId || this.blueprint.startNodeId) {
    if (this._cancelled) return { ok: false, cancelled: true };
    if (this.instance.status === "resolved") {
      this._renderTranscript();
      return { ok: true, readOnly: true };
    }
    this._run(nodeId);
    return { ok: true };
  }

  _run(nodeId) {
    if (this._cancelled) return;
    let current = nodeId;
    let guard = 0;
    while (current && guard++ < 1000) {
      const node = this.blueprint.nodes?.[current];
      if (!node) throw new Error(`Unknown flow node: ${current}`);
      if (!globalVariableManager.matches(node.condition || node.globalVariableCondition)) {
        this.appendLine("npc", String(this.definition.name || this.definition.id || "活动"), "（当前条件不满足，无法继续。）");
        this._resolve();
        return;
      }
      this.instance.currentNodeId = current;
      if (node.type === "choice") { this._showChoice(node); return; }
      if (this.instance.executedNodeIds.includes(current)) {
        current = nextFlow(this.blueprint, node);
        continue;
      }
      const result = this._execute(node);
      if (result?.waitChoice) { this._showChoice(node); return; }
      if (result?.waitUntil) {
        this.instance.waitingNodeId = node.id;
        this._subscribeWaitUntil(node.id);
        this.onCheckpoint(this.instance);
        return;
      }
      if (result?.wait) {
        const next = result.next || nextFlow(this.blueprint, node);
        this.instance.executedNodeIds.push(node.id);
        this.instance.currentNodeId = next || null;
        this.onCheckpoint(this.instance);
        if (!this.optionsEl) {
          current = next;
          continue;
        }
        this._showContinue(next);
        return;
      }
      if (result?.stop) return;
      current = result?.next || nextFlow(this.blueprint, node);
      this.instance.executedNodeIds.push(node.id);
      this.instance.currentNodeId = current || null;
      this.onCheckpoint(this.instance);
    }
    if (guard >= 1000) throw new Error("Activity flow exceeded 1000 nodes");
    this._resolve();
  }

  _execute(node) {
    const get = (name, fallback) => inputValue(this.blueprint, node, name, this.evaluator, fallback);
    if (node.onShow && node.type !== "statOperation") {
      applyDialogueOnShow(node, this.definition.npcId || this.definition.actorId || this.definition.id);
    }
    switch (node.type) {
      case "flowStart": return {};
      case "activityEnd": this._resolve(); return { stop: true };
      case "text": {
        const speaker = get("speaker", node.speaker || "npc");
        const text = String(get("text", node.text || ""));
        const displayTo = String(get("displayTo", node.displayTo || "legacy"));
        this._record({ type: "text", speaker, text, displayTo });
        if (this.definition.kind === "medicalIncident") this.instance.lastActivityText = text;
        const displayPayload = {
          type: "text", speaker, label: speaker === "player" ? "我" : String(speaker), text,
          definition: this.definition, instance: this.instance, node,
        };
        if (!displayReceiverManager.dispatch(displayTo, displayPayload)) {
          // Legacy blueprints remain playable while they are migrated. This
          // fallback is an adapter, not queue-specific presentation logic.
          this.appendLine(speaker, displayPayload.label, text);
        }
        if (this.definition.action === "investigate" && Array.isArray(node.keywordIds)) {
          this._emitInspection(node, text);
        }
        return { wait: true };
      }
      case "branch": return { next: nextFlow(this.blueprint, node, get("condition", 0) ? "true" : "false") };
      case "randomBranch": {
        const n = Number(get("n", 0));
        if (!Number.isSafeInteger(n) || n < 1 || n > 32) throw new Error("Random branch count n must be an integer from 1 to 32");
        const index = Math.min(n - 1, Math.floor(this.random() * n));
        this.instance.lastRandomBranch = { count: n, index };
        return { next: nextDynamicFlow(this.blueprint, node, `flowOut${index}`) };
      }
      case "waitUntil": {
        if (!Boolean(get("condition", false))) return { waitUntil: true };
        this.instance.waitingNodeId = null;
        this._clearWaitUntil();
        return {};
      }
      case "diceCheck": {
        const n = Math.max(1, Math.min(100, Number(get("n", 0))));
        if (!Number.isFinite(n)) throw new Error("Dice check target must be a number");
        const roll = Math.floor(this.random() * 100) + 1;
        const outcome = roll === 100 || (n < 50 && roll >= 96)
          ? "largeFailure"
          : roll <= n / 5 ? "largeSuccess" : roll <= n ? "success" : "failure";
        this.instance.lastDiceCheck = { roll, target: n, skillValue: n, outcome };
        return { next: nextFlow(this.blueprint, node, outcome) };
      }
      case "ending": this.effects.ending(String(get("endingId", ""))); return {};
      case "consumeTime": this.effects.consumeTime(get("minutes", 0)); return {};
      case "setGlobal": {
        const id = get("variableId");
        const delta = get("delta", undefined);
        this.effects.setGlobal(id, get("value"), delta);
        return {};
      }
      case "insertActivity": {
        this.effects.insertActivity(get("activityId"), get("addTime"), get("queue"), {
          respectPrerequisite: get("respectPrerequisite", true),
          protectFromExpiry: get("protectFromExpiry", false),
        });
        if (!result.ok) throw new Error(`Insert activity failed: ${result.reason}`);
        return {};
      }
      case "showCg": eventBus.emit(ACTIVITY_EVENTS.cg, { cgId: String(get("cgId", "")), instanceId: this.instance.instanceId }); return {};
      case "endCg":  eventBus.emit(ACTIVITY_EVENTS.endCg, { instanceId: this.instance.instanceId }); return {};
      case "showImage": {
        const image = String(get("image", ""));
        const displayTo = String(get("displayTo", node.displayTo || "item-inspection"));
        this.instance.inspectionImage = image || null;
        if (image) {
          const payload = { type: "image", image, itemId: this.definition.itemId, instanceId: this.instance.instanceId, definition: this.definition, node };
          displayReceiverManager.dispatch(displayTo, payload);
          eventBus.emit(ACTIVITY_EVENTS.image, payload);
        }
        return {};
      }
      case "segmentBranch": {
        const value = Number(get("value", 0));
        const count = Math.max(1, Math.min(32, Math.floor(Number(get("branchCount", 1)))));
        if (!Number.isFinite(value) || !Number.isFinite(count)) throw new Error("Segment branch value and count must be numbers");
        const boundaries = Array.from({ length: count + 1 }, (_, index) => Number(get(`boundary${index}`, 0)));
        if (boundaries.some((boundary) => !Number.isFinite(boundary)) || boundaries.some((boundary, index) => index && boundaries[index - 1] < boundary)) {
          throw new Error("Segment branch boundaries must be finite and descending");
        }
        const index = boundaries.findIndex((upper, boundaryIndex) => value <= upper && value > boundaries[boundaryIndex + 1]);
        if (index < 0) return { next: nextDynamicFlow(this.blueprint, node, "default") };
        return { next: nextDynamicFlow(this.blueprint, node, `segment${index}`) };
      }
      case "inventoryOperation": {
        const itemId = String(get("itemId", ""));
        const count = Number(get("count", 0));
        this.effects.inventory(itemId, count);
        return {};
      }
      case "statOperation": {
        this.effects.stat(get("statId", ""), get("delta", 0));
        if (node.onShow) applyDialogueOnShow(node, this.definition.npcId || this.definition.actorId || this.definition.id);
        return {};
      }
      case "spellOperation": {
        this.effects.spellOperation(node.spell || node.inputs?.spell, node.requireNew !== false);
        return {};
      }
      case "spellCast": {
        const result = this.effects.cast(get("spellId", ""), {
          target: get("target", ""),
          eventId: get("eventId", this.definition.id),
          choiceId: get("choiceId", ""),
        });
        if (!result.ok) throw new Error(result.message);
        if (result.branch && node[`${result.branch}Next`]) return { next: node[`${result.branch}Next`] };
        return {};
      }
      case "spellEffect": {
        const result = this.effects.spellEffect(get("spellId", ""), {
          target: get("target", ""),
          eventId: get("eventId", this.definition.id),
          choiceId: get("choiceId", ""),
        });
        if (result?.branch && node[`${result.branch}Next`]) return { next: node[`${result.branch}Next`] };
        return {};
      }
      default: throw new Error(`Unsupported flow node: ${node.type}`);
    }
  }

  _emitInspection(node, text) {
    const itemId = String(this.definition.itemId || "");
    const ids = Array.isArray(node.keywordIds) ? node.keywordIds : [];
    const inlineIds = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]/g)].map((match) => match[1]);
    const allIds = [...new Set([...ids, ...inlineIds])];
    const keywordDefs = keywordManager.definitionsWithSource(allIds, `物品-${this.definition.name || itemId}`);
    allIds.filter((id) => ids.includes(id)).forEach((id) => { if (keywordDefs[id]) keywordManager.collect(keywordDefs[id]); });
    const result = { text, check: this.instance.lastDiceCheck || null, keywordDefs, effect: null, image: this.instance.inspectionImage || null };
    this.instance.inspectionResult = result;
    this.onItemInspection(result);
    eventBus.emit("item:inspection-result", { itemId, result, instanceId: this.instance.instanceId });
  }


  _showChoice(node) {
    if (!this.optionsEl) throw new Error("Choice node requires an options container");
    this.optionsEl.innerHTML = "";
    const storedOptions = node.options || node.branches || [];
    const branchCountValue = inputValue(this.blueprint, node, "branchCount", this.evaluator, storedOptions.length);
    const branchCount = Number.isSafeInteger(Number(branchCountValue))
      ? Math.max(0, Math.min(32, Number(branchCountValue)))
      : storedOptions.length;
    const options = Array.from({ length: Math.max(branchCount, storedOptions.length) }, (_, index) => ({
      ...(storedOptions[index] || {}),
      _branchIndex: index,
      label: storedOptions[index]?.label || storedOptions[index]?.text || node.inputs?.[`label${index}`] || `选项${index + 1}`,
    }))
      .filter((option) => globalVariableManager.matches(option.condition || option.globalVariableCondition))
      .filter((option) => !option.requiredItemId || itemManager.count(String(option.requiredItemId)) > 0)
      .filter((option) => !option.requiredSpellId || spellManager.all().some((spell) => spell.id === String(option.requiredSpellId)));
    options.forEach((option) => {
      const index = option._branchIndex;
      const button = document.createElement("button");
      button.type = "button";
      const labelConnection = (this.blueprint.connections || []).find((item) => item.toNodeId === node.id && item.toPort === `label${index}`);
      const label = labelConnection
        ? this.evaluator.evaluateNode(labelConnection.fromNodeId, labelConnection.fromPort)
        : (option.label || option.text || "");
      button.textContent = String(label);
      if (this.choiceClassName) button.classList.add(this.choiceClassName);
      this.decorateChoice(button, { option, node, index });
      button.addEventListener("click", () => {
        if (this.readOnly) return;
        this._record({ type: "choice", index, label: button.textContent });
        if (option.effects) applyDialogueOnShow({ onShow: option.effects }, this.definition.npcId || this.definition.actorId || this.definition.id);
        this.appendLine("player", "我", button.textContent);
        this.optionsEl.innerHTML = "";
        // Typed blueprint connections are authoritative. Legacy option.next
        // values may refer to pre-migration node IDs that no longer exist.
        const next = nextDynamicFlow(this.blueprint, node, `option${index}`)
          || option.next || option.target;
        this.instance.executedNodeIds.push(node.id);
        this.instance.currentNodeId = next || null;
        this.onCheckpoint(this.instance);
        this._run(next);
        this.onChoiceSelected({ instanceId: this.instance.instanceId, nodeId: node.id, optionIndex: index });
      });
      this.optionsEl.appendChild(button);
    });
    this.onChoiceAvailable({ instanceId: this.instance.instanceId, nodeId: node.id });
    this.onCheckpoint(this.instance);
  }

  _showContinue(nextNodeId) {
    if (!this.optionsEl) throw new Error("Text node requires an options container");
    this.optionsEl.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "win95-btn dialogue-continue";
    button.textContent = "继续";
    button.addEventListener("click", () => {
      if (this.readOnly) return;
      this.optionsEl.innerHTML = "";
      this._run(nextNodeId);
    });
    this.optionsEl.appendChild(button);
  }

  _record(record) {
    if (!Array.isArray(this.instance.transcript)) this.instance.transcript = [];
    this.instance.transcript.push({ ...record });
  }

  _renderTranscript() {
    (this.instance.transcript || []).forEach((record) => {
      if (record.type === "text") {
        const label = record.speaker === "player" ? "我" : String(record.speaker);
        const payload = { ...record, label, definition: this.definition, instance: this.instance };
        if (!displayReceiverManager.dispatch(record.displayTo || "legacy", payload)) this.appendLine(record.speaker, label, record.text);
      }
      if (record.type === "choice") this.appendLine("player", "我", record.label);
    });
  }

  _resolve() {
    if (this._cancelled || this.instance.status === "resolved") return;
    this._clearWaitUntil();
    this.instance.waitingNodeId = null;
    this.instance.status = "resolved";
    this.instance.currentNodeId = null;
    this.onCheckpoint(this.instance);
    this.onComplete(this.instance);
    eventBus.emit(ACTIVITY_EVENTS.resolved, { appId: this.appId, queueId: this.queueId, instanceId: this.instance.instanceId, instance: this.instance });
    eventBus.emit(ACTIVITY_EVENTS.completed, { appId: this.appId, queueId: this.queueId, instanceId: this.instance.instanceId, instance: this.instance });
  }

  _subscribeWaitUntil(nodeId) {
    if (this._waitUntilUnsubscribers.length) return;
    const events = [
      "gamestate:changed", "global-variable:changed", "global-variables:changed",
      "items:changed", "npcState:changed", "favorability:changed", "time:changed",
      "daynight:changed", "activity:changed", "activity:appended", "spells:changed",
    ];
    const retry = () => {
      if (this._waitUntilEvaluating || this.instance.status === "resolved") return;
      this._waitUntilEvaluating = true;
      try {
        if (this.blueprint.nodes?.[nodeId]) this._run(nodeId);
      } finally {
        this._waitUntilEvaluating = false;
      }
    };
    this._waitUntilUnsubscribers = events.map((event) => eventBus.on(event, retry));
  }

  _clearWaitUntil() {
    this._waitUntilUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }

  cancel() {
    if (this._cancelled) return;
    this._cancelled = true;
    this._clearWaitUntil();
    if (this.optionsEl) this.optionsEl.innerHTML = "";
  }

  _activityStatus(instanceId) {
    const status = activityQueueRegistry.list().map((queue) => queue.statusOf(instanceId)).find((value) => value !== "nonexistent") || "nonexistent";
    return STATUS[status] ?? STATUS.nonexistent;
  }

  _activityInstanceCount(activityId) {
    return activityQueueRegistry.list().reduce((total, queue) => total + queue.countByActivity(activityId), 0);
  }
}

export function createActivityRunner(options) { return new ActivityRunner(options); }
export { STATUS as ACTIVITY_STATUS };
export default ActivityRunner;
