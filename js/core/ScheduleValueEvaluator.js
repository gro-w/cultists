import { getScheduleNodeDefinition } from "./ScheduleNodeRegistry.js";
import { getScheduleValueContext, getStatValue } from "./ScheduleValueAccess.js";

function valueOf(input, evaluate) {
  if (input && typeof input === "object" && input.nodeId) return evaluate(input.nodeId, input.port || "value");
  return input;
}

function bool(value) { return Boolean(value); }

export class ScheduleValueEvaluator {
  constructor(blueprint, context = {}) {
    this.blueprint = blueprint;
    this.context = { ...getScheduleValueContext(), ...context };
    this.cache = new Map();
    this.stack = new Set();
  }

  evaluateNode(nodeId, port = "value") {
    const key = `${nodeId}:${port}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
    const node = this.blueprint.nodes?.[nodeId];
    if (!node) throw new Error(`Unknown value node: ${nodeId}`);
    const definition = getScheduleNodeDefinition(node.type);
    if (!definition?.valueOutputs?.some((output) => output.name === port)) throw new Error(`Node ${nodeId} has no value output ${port}`);
    this.stack.add(key);
    const read = (name, fallback = undefined) => {
      const connection = (this.blueprint.connections || []).find((item) => item.toNodeId === nodeId && item.toPort === name);
      if (connection) return this.evaluateNode(connection.fromNodeId, connection.fromPort);
      return valueOf(node.inputs?.[name], (sourceId, sourcePort) => this.evaluateNode(sourceId, sourcePort));
    };
    let result;
    switch (node.type) {
      case "arithmetic": result = this._arithmetic(read("operator", "+"), read("left", 0), read("right", 0)); break;
      case "getGlobal": result = this.context.globalVariableManager.get(read("variableId")); break;
      case "getInventory": result = this.context.itemManager.count(read("itemId")); break;
      case "getProtagonistStat": result = getStatValue(read("statId")); break;
      case "getScheduleStatus": result = this.context.scheduleStatus ? this.context.scheduleStatus(read("instanceId")) : 0; break;
      case "getScheduleInstanceCount": result = this.context.scheduleInstanceCount ? this.context.scheduleInstanceCount(read("scheduleId")) : 0; break;
      case "getGameTime": result = this.context.gameState.day * 1440 + this.context.gameState.clockMinutes; break;
      default: throw new Error(`Node ${node.type} is not a value node`);
    }
    this.stack.delete(key);
    this.cache.set(key, result);
    return result;
  }

  _arithmetic(operator, left, right) {
    switch (operator) {
      case "+": case "add": return Number(left) + Number(right);
      case "-": case "subtract": return Number(left) - Number(right);
      case "*": case "multiply": return Number(left) * Number(right);
      case "/": case "divide": if (Number(right) === 0) throw new Error("Division by zero"); return Number(left) / Number(right);
      case "%": case "modulo": if (Number(right) === 0) throw new Error("Division by zero"); return Number(left) % Number(right);
      case "concat": case "拼接字符串": return String(left) + String(right);
      case "and": case "与": return bool(left) && bool(right);
      case "or": case "或": return bool(left) || bool(right);
      case "xor": case "异或": return bool(left) !== bool(right);
      case ">": case "gt": case "大于": return left > right;
      case "<": case "lt": case "小于": return left < right;
      case "=": case "eq": case "等于": return left === right;
      case "not": case "非": return !bool(left);
      default: throw new Error(`Unknown arithmetic operator: ${operator}`);
    }
  }
}

export default ScheduleValueEvaluator;
