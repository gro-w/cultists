import { normalizeBlueprint, migrateDialogueTree, validateBlueprint } from "./ScheduleBlueprint.js";
import { ScheduleValueEvaluator } from "./ScheduleValueEvaluator.js";
import { actionBudget } from "./ActionBudget.js";
import { scheduleData } from "./ScheduleData.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { modifyStatValue } from "./ScheduleValueAccess.js";
import { eventBus } from "./EventBus.js";
import { applyDialogueOnShow } from "./DialogueEffects.js";

const STATUS = Object.freeze({ nonexistent: 0, pending: 1, completed: 2 });

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

export class ScheduleRunner {
  constructor({ definition, instance, appendLine = () => {}, optionsEl = null, onComplete = () => {}, onCheckpoint = () => {}, appId = "schedule", readOnly = false } = {}) {
    this.definition = definition || {};
    this.instance = instance || { status: "pending", transcript: [] };
    this.blueprint = this.definition.blueprint
      ? normalizeBlueprint(this.definition.blueprint)
      : migrateDialogueTree(this.definition.dialogueTree || this.definition);
    this.appendLine = appendLine;
    this.optionsEl = optionsEl;
    this.onComplete = onComplete;
    this.onCheckpoint = onCheckpoint;
    this.appId = appId;
    this.readOnly = readOnly || this.instance.status === "completed";
    this.evaluator = new ScheduleValueEvaluator(this.blueprint, {
      scheduleStatus: (instanceId) => this._scheduleStatus(instanceId),
      scheduleInstanceCount: (scheduleId) => this._scheduleInstanceCount(scheduleId),
    });
    const validation = validateBlueprint(this.blueprint);
    if (!validation.ok) throw new Error(validation.errors.join("；"));
  }

  start(nodeId = this.instance.currentNodeId || this.blueprint.startNodeId) {
    if (this.instance.status === "completed") {
      this._renderTranscript();
      return { ok: true, readOnly: true };
    }
    this._run(nodeId);
    return { ok: true };
  }

  _run(nodeId) {
    let current = nodeId;
    let guard = 0;
    while (current && guard++ < 1000) {
      const node = this.blueprint.nodes?.[current];
      if (!node) throw new Error(`Unknown flow node: ${current}`);
      this.instance.currentNodeId = current;
      this.onCheckpoint(this.instance);
      if (node.type === "choice") { this._showChoice(node); return; }
      const result = this._execute(node);
      if (result?.wait) return;
      current = result?.next || nextFlow(this.blueprint, node);
    }
    if (guard >= 1000) throw new Error("Schedule flow exceeded 1000 nodes");
    this._complete();
  }

  _execute(node) {
    const get = (name, fallback) => inputValue(this.blueprint, node, name, this.evaluator, fallback);
    switch (node.type) {
      case "flowStart": return {};
      case "text": {
        const speaker = get("speaker", node.speaker || "npc");
        const text = String(get("text", node.text || ""));
        if (node.onShow) applyDialogueOnShow(node, this.definition.npcId || this.definition.actorId || this.definition.id);
        this._record({ type: "text", speaker, text });
        this.appendLine(speaker, speaker === "player" ? "我" : String(speaker), text);
        return {};
      }
      case "branch": return { next: nextFlow(this.blueprint, node, get("condition", 0) ? "true" : "false") };
      case "consumeTime": actionBudget.consumeTime(get("minutes", 0)); return {};
      case "setGlobal": globalVariableManager.set(get("variableId"), get("value")); return {};
      case "insertSchedule": {
        const result = scheduleData.addSchedule(get("scheduleId"), get("addTime"), get("queue"));
        if (!result.ok) throw new Error(`Insert schedule failed: ${result.reason}`);
        return {};
      }
      case "showCg": eventBus.emit("schedule:cg", { cgId: String(get("cgId", "0")), instanceId: this.instance.instanceId }); return {};
      case "inventoryOperation": {
        const itemId = String(get("itemId", ""));
        const count = Number(get("count", 0));
        if (!Number.isInteger(count)) throw new Error("Inventory operation count must be an integer");
        if (count > 0) itemManager.add(itemId, count);
        else if (count < 0) itemManager.remove(itemId, -count);
        else itemManager.remove(itemId, itemManager.count(itemId));
        return {};
      }
      case "statOperation": modifyStatValue(get("statId", ""), get("delta", 0)); return {};
      default: throw new Error(`Unsupported flow node: ${node.type}`);
    }
  }

  _showChoice(node) {
    if (!this.optionsEl) throw new Error("Choice node requires an options container");
    this.optionsEl.innerHTML = "";
    const options = node.options || node.branches || [];
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const labelConnection = (this.blueprint.connections || []).find((item) => item.toNodeId === node.id && item.toPort === `label${index}`);
      const label = labelConnection
        ? this.evaluator.evaluateNode(labelConnection.fromNodeId, labelConnection.fromPort)
        : (option.label || option.text || "");
      button.textContent = String(label);
      button.addEventListener("click", () => {
        if (this.readOnly) return;
        this._record({ type: "choice", index, label: button.textContent });
        if (option.effects) applyDialogueOnShow({ onShow: option.effects }, this.definition.npcId || this.definition.actorId || this.definition.id);
        this.appendLine("player", "我", button.textContent);
        this.optionsEl.innerHTML = "";
        this._run(option.next || option.target || nextFlow(this.blueprint, node, `option${index}`));
      });
      this.optionsEl.appendChild(button);
    });
    this.onCheckpoint(this.instance);
  }

  _record(record) {
    if (!Array.isArray(this.instance.transcript)) this.instance.transcript = [];
    this.instance.transcript.push({ ...record });
  }

  _renderTranscript() {
    (this.instance.transcript || []).forEach((record) => {
      if (record.type === "text") this.appendLine(record.speaker, record.speaker === "player" ? "我" : String(record.speaker), record.text);
      if (record.type === "choice") this.appendLine("player", "我", record.label);
    });
  }

  _complete() {
    this.instance.status = "completed";
    this.instance.currentNodeId = null;
    this.onCheckpoint(this.instance);
    this.onComplete(this.instance);
    eventBus.emit("schedule:completed", { appId: this.appId, instance: this.instance });
  }

  _scheduleStatus(instanceId) {
    const entry = [...scheduleData.queue("work").getAll(), ...scheduleData.queue("social").getAll()].find((item) => item.instanceId === instanceId);
    return !entry ? STATUS.nonexistent : entry.status === "completed" ? STATUS.completed : STATUS.pending;
  }

  _scheduleInstanceCount(scheduleId) {
    return [...scheduleData.queue("work").getAll(), ...scheduleData.queue("social").getAll()]
      .filter((item) => item.scheduleId === scheduleId || item.payload?.id === scheduleId).length;
  }
}

export function createScheduleRunner(options) { return new ScheduleRunner(options); }
export { STATUS as SCHEDULE_STATUS };
export default ScheduleRunner;
