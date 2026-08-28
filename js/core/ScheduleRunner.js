import { normalizeBlueprint, validateBlueprint } from "./ScheduleBlueprint.js";
import { ScheduleValueEvaluator } from "./ScheduleValueEvaluator.js";
import { timeService } from "./TimeService.js";
import { scheduleData } from "./ScheduleData.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { modifyStatValue } from "./ScheduleValueAccess.js";
import { eventBus } from "./EventBus.js";
import { applyDialogueOnShow } from "./DialogueEffects.js";
import { spellManager } from "./SpellManager.js";

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

export class ScheduleRunner {
  constructor({ definition, instance, appendLine = () => {}, optionsEl = null, onComplete = () => {}, onCheckpoint = () => {}, appId = "schedule", readOnly = false, random = Math.random } = {}) {
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
    this.appId = appId;
    this.readOnly = readOnly || this.instance.status === "resolved";
    this.evaluator = new ScheduleValueEvaluator(this.blueprint, {
      scheduleStatus: (instanceId) => this._scheduleStatus(instanceId),
      scheduleInstanceCount: (scheduleId) => this._scheduleInstanceCount(scheduleId),
    });
    const validation = validateBlueprint(this.blueprint);
    if (!validation.ok) throw new Error(validation.errors.join("；"));
  }

  start(nodeId = this.instance.currentNodeId || this.blueprint.startNodeId) {
    if (this.instance.status === "resolved") {
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
      if (!globalVariableManager.matches(node.condition || node.globalVariableCondition)) {
        this.appendLine("npc", String(this.definition.name || this.definition.id || "日程"), "（当前条件不满足，无法继续。）");
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
      if (result?.wait) return;
      if (result?.stop) return;
      current = result?.next || nextFlow(this.blueprint, node);
      this.instance.executedNodeIds.push(node.id);
      this.instance.currentNodeId = current || null;
      this.onCheckpoint(this.instance);
    }
    if (guard >= 1000) throw new Error("Schedule flow exceeded 1000 nodes");
    this._resolve();
  }

  _execute(node) {
    const get = (name, fallback) => inputValue(this.blueprint, node, name, this.evaluator, fallback);
    switch (node.type) {
      case "flowStart": return {};
      case "scheduleEnd": this._resolve(); return { stop: true };
      case "text": {
        const speaker = get("speaker", node.speaker || "npc");
        const text = String(get("text", node.text || ""));
        if (node.onShow) applyDialogueOnShow(node, this.definition.npcId || this.definition.actorId || this.definition.id);
        this._record({ type: "text", speaker, text });
        this.appendLine(speaker, speaker === "player" ? "我" : String(speaker), text);
        return { waitChoice: Array.isArray(node.options) && node.options.length > 0 };
      }
      case "branch": return { next: nextFlow(this.blueprint, node, get("condition", 0) ? "true" : "false") };
      case "diceCheck": {
        const n = Math.max(1, Math.min(100, Number(get("n", 0))));
        if (!Number.isFinite(n)) throw new Error("Dice check target must be a number");
        const roll = Math.floor(this.random() * 100) + 1;
        const port = roll === 100 || (n < 50 && roll >= 96)
          ? "largeFailure"
          : roll <= n / 5 ? "largeSuccess" : roll <= n ? "success" : "failure";
        return { next: nextFlow(this.blueprint, node, port) };
      }
      case "consumeTime": timeService.advanceBy(get("minutes", 0)); return {};
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
      case "spellOperation": {
        const learned = spellManager.learn(node.spell || node.inputs?.spell);
        if (!learned && node.requireNew !== false) throw new Error("Spell is already known or invalid");
        return {};
      }
      default: throw new Error(`Unsupported flow node: ${node.type}`);
    }
  }

  _showChoice(node) {
    if (!this.optionsEl) throw new Error("Choice node requires an options container");
    this.optionsEl.innerHTML = "";
    const storedOptions = node.options || node.branches || [];
    const branchCount = Number.isInteger(Number(node.inputs?.branchCount))
      ? Math.max(0, Math.min(32, Number(node.inputs.branchCount)))
      : storedOptions.length;
    const options = Array.from({ length: Math.max(branchCount, storedOptions.length) }, (_, index) => ({
      ...(storedOptions[index] || {}),
      _branchIndex: index,
      label: storedOptions[index]?.label || storedOptions[index]?.text || node.inputs?.[`label${index}`] || `选项${index + 1}`,
    }))
      .filter((option) => globalVariableManager.matches(option.condition || option.globalVariableCondition));
    options.forEach((option) => {
      const index = option._branchIndex;
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
        const next = option.next || option.target || nextFlow(this.blueprint, node, `option${index}`);
        this.instance.executedNodeIds.push(node.id);
        this.instance.currentNodeId = next || null;
        this.onCheckpoint(this.instance);
        this._run(next);
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

  _resolve() {
    if (this.instance.status === "resolved") return;
    this.instance.status = "resolved";
    this.instance.currentNodeId = null;
    this.onCheckpoint(this.instance);
    this.onComplete(this.instance);
    eventBus.emit("schedule:resolved", { appId: this.appId, instance: this.instance });
    eventBus.emit("schedule:completed", { appId: this.appId, instance: this.instance });
  }

  _scheduleStatus(instanceId) {
    const queues = ["work", "social", "chatgtp", "realtime"];
    const status = queues.map((id) => scheduleData.queue(id).statusOf(instanceId)).find((value) => value !== "nonexistent") || "nonexistent";
    return STATUS[status] ?? STATUS.nonexistent;
  }

  _scheduleInstanceCount(scheduleId) {
    return ["work", "social", "chatgtp", "realtime"].reduce((total, queueId) => total + scheduleData.queue(queueId).countBySchedule(scheduleId), 0);
  }
}

export function createScheduleRunner(options) { return new ScheduleRunner(options); }
export { STATUS as SCHEDULE_STATUS };
export default ScheduleRunner;
