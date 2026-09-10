/**
 * Generic data-driven event router.
 *
 * Core only routes opaque event names to declared Activities and performs
 * generic runtime-collection mutations. Domain names, payload paths, and
 * collection IDs are supplied by Framework/Game data.
 */
function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function readPath(value, path) {
  if (!path) return value;
  return String(path).split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}

function resolve(value, payload, variableStore, resources = {}) {
  if (Array.isArray(value)) return value.map((item) => resolve(item, payload, variableStore, resources));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && typeof value.path === "string") return clone(readPath(payload, value.path));
  if (Object.keys(value).length === 1 && typeof value.variable === "string") return clone(variableStore?.get(value.variable));
  if (typeof value.resource === "string") {
    const id = resolve(value.id, payload, variableStore, resources);
    const record = resources[value.resource]?.get(String(id));
    return clone(value.field ? record?.[value.field] : record);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child, payload, variableStore, resources)]));
}

export class EventActivityRouter {
  constructor({ eventBus, variableStore, runtimeGateway, displayRegistry, resources = {}, runActivity, routes = [] } = {}) {
    this.eventBus = eventBus;
    this.variableStore = variableStore;
    this.runtimeGateway = runtimeGateway;
    this.displayRegistry = displayRegistry;
    this.resources = resources;
    this.runActivity = runActivity;
    this.routes = Array.isArray(routes) ? routes : [];
    this.unsubscribers = [];
  }

  start() {
    this.stop();
    for (const route of this.routes) {
      if (!route?.event) continue;
      this.unsubscribers.push(this.eventBus.on(route.event, (payload) => this.handle(route, payload || {})));
    }
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  }

  handle(route, payload = {}) {
    this.variableStore?.set("event:name", route.event);
    this.variableStore?.set("event:payload", clone(payload));
    for (const action of route.actions || []) this.applyAction(action, payload);
    if (route.activityId && this.runActivity) return this.runActivity(route.activityId, route.queueId || "main");
    return true;
  }

  applyAction(action, payload) {
    const value = resolve(action.value, payload, this.variableStore, this.resources);
    switch (action.type) {
      case "collection.set":
        return this.runtimeGateway.setCollectionValue(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), value);
      case "collection.mutate":
        return this.runtimeGateway.mutateCollection(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), action.operation || "delta", value);
      case "collection.operation":
        return this.runtimeGateway.operateCollection(action.collectionId, resolve(action.recordId, payload, this.variableStore, this.resources), { operation: action.operation || "delta", value, minimum: resolve(action.minimum, payload, this.variableStore, this.resources) });
      case "collection.append":
        return this.runtimeGateway.appendCollectionValue(action.collectionId, value);
      case "variable.set":
        this.variableStore.set(action.key, value);
        return value;
      case "event.emit":
        this.eventBus.emit(action.event, value);
        return value;
      case "display.dispatch": {
        const displayPayload = { ...(value || {}), type: action.displayType || value?.type };
        return this.displayRegistry?.dispatch(resolve(action.target || "default", payload, this.variableStore, this.resources), displayPayload);
      }
      default:
        throw new Error(`Unknown event route action: ${action.type}`);
    }
  }
}

export default EventActivityRouter;
