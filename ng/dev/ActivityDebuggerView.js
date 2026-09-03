// DEV-TOOLS:START
import { ACTIVITY_EVENTS } from "../core/ActivityEvents.js";

/**
 * ActivityDebuggerView - a read-only dev-tool window showing the live
 * runtime state of every ActivityQueue (plan item 5: "调试器(显示目前游戏中
 * 的活动队列有哪些等等运行时情况)"). Distinct from the Activity 列表管理器
 * (which edits static blueprints/definitions) - this only ever reads
 * `activityQueueRegistry`, never mutates it, and auto-refreshes whenever the
 * shared eventBus reports any ACTIVITY_EVENTS change.
 */
export class ActivityDebuggerView {
  constructor({ activityQueueRegistry, eventBus }) {
    this.activityQueueRegistry = activityQueueRegistry;
    this.eventBus = eventBus;
    this._unsubscribers = [];
    this._buildDom();
    this._bindEvents();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-activity-debugger";
    el.innerHTML = `
      <div class="ng-debugger-toolbar">
        <button type="button" data-action="refresh">刷新</button>
        <span class="ng-debugger-status"></span>
      </div>
      <div class="ng-debugger-body"></div>
    `;
    this.el = el;
    this.bodyEl = el.querySelector(".ng-debugger-body");
    this.statusEl = el.querySelector(".ng-debugger-status");
    el.querySelector('[data-action="refresh"]').addEventListener("click", () => this.render());
  }

  _bindEvents() {
    if (!this.eventBus) return;
    for (const eventName of Object.values(ACTIVITY_EVENTS)) {
      this._unsubscribers.push(this.eventBus.on(eventName, () => this.render()));
    }
  }

  render() {
    this.bodyEl.innerHTML = "";
    const queues = this.activityQueueRegistry ? this.activityQueueRegistry.list() : [];
    if (!queues.length) {
      this.bodyEl.textContent = "没有已注册的活动队列";
      return;
    }
    for (const queue of queues) {
      this.bodyEl.appendChild(this._renderQueue(queue));
    }
    this.statusEl.textContent = `最后刷新: ${new Date().toLocaleTimeString()}`;
  }

  _renderQueue(queue) {
    const section = document.createElement("div");
    section.className = "ng-debugger-queue";
    const title = document.createElement("div");
    title.className = "ng-debugger-queue-title";
    title.textContent = `队列: ${queue.queueId}${queue.nonBlocking ? " (非阻塞)" : ""} - ${queue.entries.length} 个实例`;
    section.appendChild(title);

    const table = document.createElement("table");
    table.className = "ng-debugger-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>instanceId</th>
          <th>activityId</th>
          <th>status</th>
          <th>currentNodeId</th>
          <th>waitingNodeId</th>
          <th>resolutionReason</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    for (const entry of queue.entries) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${entry.instanceId}</td>
        <td>${entry.activityId}</td>
        <td>${entry.status}</td>
        <td>${entry.currentNodeId ?? ""}</td>
        <td>${entry.waitingNodeId ?? ""}</td>
        <td>${entry.resolutionReason ?? ""}</td>
      `;
      tbody.appendChild(row);
    }
    section.appendChild(table);
    return section;
  }

  dispose() {
    this._unsubscribers.forEach((unsubscribe) => unsubscribe());
    this._unsubscribers = [];
  }
}

export default ActivityDebuggerView;
// DEV-TOOLS:END
