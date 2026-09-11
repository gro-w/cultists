// DEV-TOOLS:START
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";

/** Live runtime Activity inspector. All mutations go through queue/execution APIs. */
export class ActivityDebuggerView {
  constructor({ activityQueueRegistry, activityDefinitionStore, activityExecutionService, localVariableManager, eventBus }) {
    this.activityQueueRegistry = activityQueueRegistry;
    this.activityDefinitionStore = activityDefinitionStore;
    this.activityExecutionService = activityExecutionService;
    this.localVariableManager = localVariableManager;
    this.eventBus = eventBus;
    this._unsubscribers = [];
    this._buildDom();
    this._bindEvents();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-activity-debugger";
    el.innerHTML = `<div class="ng-debugger-toolbar"><button data-action="refresh">刷新</button><select data-role="new-activity"></select><select data-role="new-queue"></select><button data-action="create">创建并入队</button><span class="ng-debugger-status"></span></div><div class="ng-debugger-body"></div>`;
    this.el = el;
    this.bodyEl = el.querySelector(".ng-debugger-body");
    this.statusEl = el.querySelector(".ng-debugger-status");
    el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
    el.querySelector('[data-action="create"]').addEventListener("click", () => this.createInstance());
  }

  _bindEvents() {
    if (!this.eventBus) return;
    for (const eventName of [...Object.values(ACTIVITY_EVENTS), "activity:local-variable-changed"]) this._unsubscribers.push(this.eventBus.on(eventName, () => this.render()));
  }

  render() {
    const activities = this.activityDefinitionStore?.list() || [];
    const activitySelect = this.el.querySelector('[data-role="new-activity"]');
    const queueSelect = this.el.querySelector('[data-role="new-queue"]');
    const selectedActivity = activitySelect.value;
    const selectedQueue = queueSelect.value;
    activitySelect.innerHTML = activities.map((item) => `<option value="${this.escape(item.id)}">${this.escape(item.displayName || item.id)}</option>`).join("");
    queueSelect.innerHTML = (this.activityQueueRegistry?.list() || []).map((queue) => `<option value="${this.escape(queue.queueId)}">${this.escape(queue.queueId)}</option>`).join("");
    if (selectedActivity) activitySelect.value = selectedActivity;
    if (selectedQueue) queueSelect.value = selectedQueue;
    this.bodyEl.innerHTML = "";
    for (const queue of this.activityQueueRegistry?.list() || []) this.bodyEl.appendChild(this.renderQueue(queue));
    this.statusEl.textContent = `实时更新 · ${new Date().toLocaleTimeString()}`;
  }

  escape(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"); }

  createInstance() {
    const activityId = this.el.querySelector('[data-role="new-activity"]').value;
    const queueId = this.el.querySelector('[data-role="new-queue"]').value || "main";
    const definition = this.activityDefinitionStore?.get(activityId);
    if (!definition) return;
    this.activityQueueRegistry.append(queueId, { activityId, currentNodeId: definition.blueprint?.startNodeId || null });
  }

  renderQueue(queue) {
    const section = document.createElement("div");
    section.className = "ng-debugger-queue";
    const title = document.createElement("div");
    title.className = "ng-debugger-queue-title";
    title.textContent = `队列: ${queue.queueId}${queue.nonBlocking ? " (非阻塞)" : ""} - ${queue.entries.length} 个实例`;
    section.appendChild(title);
    const table = document.createElement("table");
    table.className = "ng-debugger-table";
    table.innerHTML = "<thead><tr><th>instance</th><th>activity</th><th>状态</th><th>执行节点</th><th>本地变量</th><th>队列操作</th></tr></thead><tbody></tbody>";
    const tbody = table.querySelector("tbody");
    queue.entries.forEach((entry) => tbody.appendChild(this.renderEntry(queue, entry)));
    section.appendChild(table);
    return section;
  }

  renderEntry(queue, entry) {
    const row = document.createElement("tr");
    const definition = this.activityDefinitionStore?.get(entry.activityId);
    const nodeSelect = document.createElement("select");
    Object.values(definition?.blueprint?.nodes || {}).forEach((node) => { const option = new Option(`${node.id} · ${node.type}`, node.id); option.selected = node.id === entry.currentNodeId; nodeSelect.add(option); });
    nodeSelect.addEventListener("change", () => this.activityExecutionService?.update(queue, entry.instanceId, { currentNodeId: nodeSelect.value }));
    const statusSelect = document.createElement("select");
    ["unresolved", "paused", "failed", "resolved"].forEach((status) => { const option = new Option(status, status); option.selected = status === entry.status; statusSelect.add(option); });
    statusSelect.addEventListener("change", () => this.activityExecutionService?.update(queue, entry.instanceId, { status: statusSelect.value }));
    const local = document.createElement("div");
    const localValues = { ...(entry.localVariables || {}) };
    (this.localVariableManager?.list() || []).forEach((definition) => {
      if (!Object.prototype.hasOwnProperty.call(localValues, definition.id)) localValues[definition.id] = definition.defaultValue;
    });
    Object.entries(localValues).forEach(([key, value]) => {
      const input = document.createElement("input"); input.value = typeof value === "object" ? JSON.stringify(value) : value ?? ""; input.title = key;
      input.addEventListener("change", () => { let next = input.value; try { next = typeof value === "object" ? JSON.parse(next) : next; } catch { this.statusEl.textContent = "本地变量 JSON 无效"; return; } this.activityExecutionService?.setLocalVariable(entry.instanceId, key, next); });
      const label = document.createElement("label"); label.textContent = `${key}: `; label.appendChild(input); local.appendChild(label);
    });
    const remove = document.createElement("button"); remove.textContent = "移出队列"; remove.addEventListener("click", () => this.activityQueueRegistry.removeEntry(queue.queueId, entry.instanceId));
    const cells = [entry.instanceId, entry.activityId, statusSelect, nodeSelect, local, remove];
    cells.forEach((value) => { const cell = document.createElement("td"); if (typeof value === "string") cell.textContent = value; else cell.appendChild(value); row.appendChild(cell); });
    return row;
  }

  dispose() { this._unsubscribers.forEach((unsubscribe) => unsubscribe()); this._unsubscribers = []; }
}

export default ActivityDebuggerView;
// DEV-TOOLS:END