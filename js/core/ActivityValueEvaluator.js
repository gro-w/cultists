import { getActivityNodeDefinition } from "./ActivityNodeRegistry.js";
import { getActivityValueContext } from "./ActivityValueAccess.js";

function valueOf(input, evaluate) {
  if (input && typeof input === "object" && input.nodeId) return evaluate(input.nodeId, input.port || "value");
  return input;
}

function bool(value) { return Boolean(value); }

export class ActivityValueEvaluator {
  constructor(blueprint, context = {}) {
    this.blueprint = blueprint;
    this.context = { ...getActivityValueContext(), ...context };
    this.cache = new Map();
    this.stack = new Set();
  }

  evaluateNode(nodeId, port = "value") {
    const key = `${nodeId}:${port}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.stack.has(key)) throw new Error(`Circular value dependency at ${key}`);
    const node = this.blueprint.nodes?.[nodeId];
    if (!node) throw new Error(`Unknown value node: ${nodeId}`);
    const definition = getActivityNodeDefinition(node.type);
    if (!definition?.valueOutputs?.some((output) => output.name === port)) throw new Error(`Node ${nodeId} has no value output ${port}`);
    this.stack.add(key);
    const read = (name, fallback = undefined) => this.readInput(nodeId, name, fallback);
    let result;
    switch (node.type) {
      case "arithmetic": result = this._arithmetic(read("operator", "+"), read("left", 0), read("right", 0)); break;
      case "getGlobal": result = this.context.globalVariableManager.get(read("variableId")); break;
      case "getInventory": result = this.context.itemManager.count(read("itemId")); break;
      case "getActivityStatus": result = this.context.activityStatus ? this.context.activityStatus(read("instanceId")) : 0; break;
      case "getActivityInstanceCount": result = this.context.activityInstanceCount ? this.context.activityInstanceCount(read("activityId")) : 0; break;
      case "getGameTime": result = this.context.gameState.day * 1440 + this.context.gameState.clockMinutes; break;
      default: throw new Error(`Node ${node.type} is not a value node`);
    }
    this.stack.delete(key);
    this.cache.set(key, result);
    return result;
  }

  readInput(nodeId, name, fallback = undefined) {
    const node = this.blueprint.nodes?.[nodeId];
    const connection = (this.blueprint.connections || []).find((item) => item.toNodeId === nodeId && item.toPort === name);
    if (connection) return this.evaluateNode(connection.fromNodeId, connection.fromPort);
    if (Object.prototype.hasOwnProperty.call(node?.inputs || {}, name)) return valueOf(node.inputs[name], (sourceId, sourcePort) => this.evaluateNode(sourceId, sourcePort));
    return fallback;
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
      case ">=": case "gte": case "大于等于": return left >= right;
      case "<": case "lt": case "小于": return left < right;
      case "<=": case "lte": case "小于等于": return left <= right;
      case "=": case "eq": case "等于": return left === right;
      case "not": case "非": return !bool(left);
      default: throw new Error(`Unknown arithmetic operator: ${operator}`);
    }
  }
}

export default ActivityValueEvaluator;
