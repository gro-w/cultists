// DEV-TOOLS:START
import { PointerInteraction } from "../desktop/PointerInteraction.js";
import { ACTIVITY_NODE_TYPES, getActivityNodeDefinition } from "../core/ActivityNodeRegistry.js";
import { createActivityEditorModel } from "./ActivityEditorModel.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";

const NODE_WIDTH = 140;
const NODE_HEADER_HEIGHT = 22;
const PORT_ROW_HEIGHT = 16;

/**
 * ActivityEditorView - DOM rendering + gesture wiring for one Activity
 * editor window (plan §6.2). All state lives in an ActivityEditorModel
 * instance owned exclusively by this view; nothing is read from or written
 * to module-level state, so opening N editor windows creates N fully
 * independent models + views.
 */
export class ActivityEditorView {
  constructor({ activityId, blueprint, displayName, onSaveToMemory, dataFileName } = {}) {
    this.model = createActivityEditorModel({ activityId, blueprint, displayName });
    this.onSaveToMemory = onSaveToMemory || (() => {});
    this.dataFileName = dataFileName || null;
    this._dragPointer = new PointerInteraction();
    this._connectionDragPointer = new PointerInteraction();
    this._boxSelectPointer = new PointerInteraction();
    this._pendingConnection = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    const el = document.createElement("div");
    el.className = "ng-activity-editor";
    el.innerHTML = `
      <div class="ng-editor-toolbar">
        <button type="button" data-action="undo" title="撤销">撤销</button>
        <button type="button" data-action="redo" title="重做">重做</button>
        <button type="button" data-action="validate" title="校验">校验</button>
        <button type="button" data-action="save" title="保存到内存">保存到内存</button>
        <button type="button" data-action="download" title="下载 JSON">下载</button>
        <button type="button" data-action="write-disk" title="写入磁盘">写入磁盘</button>
        <span class="ng-editor-status"></span>
      </div>
      <div class="ng-editor-body">
        <div class="ng-editor-palette"></div>
        <div class="ng-editor-canvas-wrap">
          <svg class="ng-editor-connections"></svg>
          <div class="ng-editor-canvas"></div>
        </div>
        <div class="ng-editor-inspector"></div>
      </div>
    `;
    this.el = el;
    this.statusEl = el.querySelector(".ng-editor-status");
    this.paletteEl = el.querySelector(".ng-editor-palette");
    this.canvasEl = el.querySelector(".ng-editor-canvas");
    this.canvasWrapEl = el.querySelector(".ng-editor-canvas-wrap");
    this.connectionsEl = el.querySelector(".ng-editor-connections");
    this.inspectorEl = el.querySelector(".ng-editor-inspector");

    this._buildPalette();
    this._bindToolbar();
    this._bindCanvas();
  }

  _buildPalette() {
    this.paletteEl.innerHTML = "";
    for (const type of ACTIVITY_NODE_TYPES) {
      const definition = getActivityNodeDefinition(type);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ng-editor-palette-item";
      button.textContent = definition.label;
      button.addEventListener("click", () => {
        const node = this.model.addNode(type, 60 + Math.random() * 40, 60 + Math.random() * 200);
        this.model.selectOnly(node.id);
        this.render();
      });
      this.paletteEl.appendChild(button);
    }
  }

  _bindToolbar() {
    this.el.querySelector('[data-action="undo"]').addEventListener("click", () => {
      this.model.undo();
      this.render();
    });
    this.el.querySelector('[data-action="redo"]').addEventListener("click", () => {
      this.model.redo();
      this.render();
    });
    this.el.querySelector('[data-action="validate"]').addEventListener("click", () => {
      const result = this.model.validateForSave();
      this._setStatus(result.ok ? "校验通过" : `校验失败: ${result.errors.join("；")}`, !result.ok);
    });
    this.el.querySelector('[data-action="save"]').addEventListener("click", () => this._save());
    this.el.querySelector('[data-action="download"]').addEventListener("click", () => {
      downloadTextFile(`${this.model.activityId || "activity"}.json`, this.model.toDownloadPayload());
    });
    this.el.querySelector('[data-action="write-disk"]').addEventListener("click", () => this._writeToDisk());
  }

  _save() {
    const result = this.model.validateForSave();
    if (!result.ok) {
      this._setStatus(`未保存，校验失败: ${result.errors.join("；")}`, true);
      return false;
    }
    this.onSaveToMemory(this.model.exportBlueprint());
    this._setStatus("已保存到内存");
    return true;
  }

  async _writeToDisk() {
    if (!this.dataFileName) {
      this._setStatus("此 Activity 未关联磁盘文件，无法写入", true);
      return;
    }
    if (!this._save()) return;
    try {
      await writeDataFile(this.dataFileName, this.model.toDownloadPayload());
      this._setStatus(`已写入 ${this.dataFileName}`);
    } catch (error) {
      this._setStatus(`写入失败: ${error.message}`, true);
    }
  }

  _setStatus(text, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("ng-editor-status-error", isError);
  }

  _bindCanvas() {
    this.canvasEl.addEventListener("pointerdown", (e) => {
      const portEl = e.target.closest("[data-port-name]");
      if (portEl) return this._startConnectionDrag(e, portEl);
      const nodeEl = e.target.closest(".ng-editor-node");
      if (nodeEl) return this._startNodeDrag(e, nodeEl);
      // Clicked empty canvas: clear selection and start a box-select.
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.model.clearSelection();
      this._startBoxSelect(e);
      this.render();
    });
  }

  _canvasPoint(clientX, clientY) {
    const rect = this.canvasEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  _startNodeDrag(e, nodeEl) {
    const id = nodeEl.dataset.nodeId;
    const additive = e.ctrlKey || e.metaKey;
    if (additive) this.model.toggleSelect(id);
    else if (!this.model.isSelected(id)) this.model.selectOnly(id);
    this.render();
    if (!this.model.isSelected(id)) return;

    const start = this._canvasPoint(e.clientX, e.clientY);
    let last = start;
    let began = false;
    this._dragPointer.start({
      onMove: (moveEvent) => {
        const point = this._canvasPoint(moveEvent.clientX, moveEvent.clientY);
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (!dx && !dy) return;
        if (!began) { this.model.beginDrag(); began = true; }
        this.model.moveSelected(dx, dy);
        last = point;
        this.render();
      },
    });
  }

  _startBoxSelect(e) {
    const origin = this._canvasPoint(e.clientX, e.clientY);
    const additive = e.shiftKey;
    const box = document.createElement("div");
    box.className = "ng-editor-box-select";
    this.canvasEl.appendChild(box);
    const updateBox = (point) => {
      const rect = {
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
      };
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      return rect;
    };
    updateBox(origin);
    this._boxSelectPointer.start({
      onMove: (moveEvent) => {
        const rect = updateBox(this._canvasPoint(moveEvent.clientX, moveEvent.clientY));
        this.model.selectInBox(rect, { additive });
        this.render();
      },
      onEnd: () => box.remove(),
    });
  }

  _startConnectionDrag(e, portEl) {
    e.stopPropagation();
    const nodeId = portEl.closest(".ng-editor-node").dataset.nodeId;
    const portName = portEl.dataset.portName;
    const direction = portEl.dataset.portDirection;
    if (direction !== "output") return; // connections are always dragged from an output port
    this._pendingConnection = { fromNodeId: nodeId, fromPort: portName };
    this._connectionDragPointer.start({
      onMove: () => this.render(),
      onEnd: (upEvent) => {
        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetPort = target?.closest('[data-port-direction="input"]');
        if (targetPort) {
          const toNodeId = targetPort.closest(".ng-editor-node").dataset.nodeId;
          const toPort = targetPort.dataset.portName;
          const result = this.model.connect(this._pendingConnection.fromNodeId, this._pendingConnection.fromPort, toNodeId, toPort);
          this._setStatus(result.ok ? "已连接" : `连接失败: ${result.error}`, !result.ok);
        }
        this._pendingConnection = null;
        this.render();
      },
    });
  }

  _portPosition(nodeId, direction, index, count) {
    const node = this.model.getNode(nodeId);
    if (!node) return { x: 0, y: 0 };
    const y = node.y + NODE_HEADER_HEIGHT + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    const x = direction === "output" ? node.x + NODE_WIDTH : node.x;
    return { x, y };
  }

  render() {
    this._renderNodes();
    this._renderConnections();
    this._renderInspector();
  }

  _renderNodes() {
    const nodes = this.model.listNodes();
    const existingIds = new Set(nodes.map((n) => n.id));
    [...this.canvasEl.querySelectorAll(".ng-editor-node")].forEach((el) => {
      if (!existingIds.has(el.dataset.nodeId)) el.remove();
    });

    for (const node of nodes) {
      let el = this.canvasEl.querySelector(`.ng-editor-node[data-node-id="${cssEscape(node.id)}"]`);
      const definition = getActivityNodeDefinition(node.type);
      if (!el) {
        el = document.createElement("div");
        el.className = "ng-editor-node bevel-out";
        el.dataset.nodeId = node.id;
        el.innerHTML = `
          <div class="ng-editor-node-header"></div>
          <div class="ng-editor-node-ports"></div>
        `;
        this.canvasEl.appendChild(el);
      }
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${NODE_WIDTH}px`;
      el.classList.toggle("selected", this.model.isSelected(node.id));
      el.querySelector(".ng-editor-node-header").textContent = `${definition?.label || node.type}`;
      const portsEl = el.querySelector(".ng-editor-node-ports");
      portsEl.innerHTML = "";
      (definition?.flowInputs || []).forEach((port) => {
        portsEl.appendChild(this._buildPortRow(port, "input"));
      });
      (definition?.flowOutputs || []).forEach((port) => {
        portsEl.appendChild(this._buildPortRow(port, "output"));
      });
    }
  }

  _buildPortRow(port, direction) {
    const row = document.createElement("div");
    row.className = `ng-editor-port-row ng-editor-port-${direction}`;
    row.innerHTML = `<span class="ng-editor-port-dot" data-port-name="${port.name}" data-port-direction="${direction}"></span><span class="ng-editor-port-label">${port.name}</span>`;
    return row;
  }

  _renderConnections() {
    const svg = this.connectionsEl;
    svg.innerHTML = "";
    const connections = this.model.listConnections();
    const nodes = this.model.listNodes();
    const outputCounts = new Map();
    const inputCounts = new Map();
    nodes.forEach((node) => {
      const definition = getActivityNodeDefinition(node.type);
      (definition?.flowOutputs || []).forEach((port, index) => outputCounts.set(`${node.id}:${port.name}`, index));
      (definition?.flowInputs || []).forEach((port, index) => inputCounts.set(`${node.id}:${port.name}`, index));
    });
    for (const connection of connections) {
      const from = this._portPosition(connection.fromNodeId, "output", outputCounts.get(`${connection.fromNodeId}:${connection.fromPort}`) || 0);
      const to = this._portPosition(connection.toNodeId, "input", inputCounts.get(`${connection.toNodeId}:${connection.toPort}`) || 0);
      svg.appendChild(this._buildConnectionPath(from, to));
    }
  }

  _buildConnectionPath(from, to) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const midX = (from.x + to.x) / 2;
    path.setAttribute("d", `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`);
    path.setAttribute("class", "ng-editor-connection-path");
    return path;
  }

  _renderInspector() {
    const selection = this.model.getSelection();
    this.inspectorEl.innerHTML = "";
    if (selection.length !== 1) {
      this.inspectorEl.textContent = selection.length ? `已选中 ${selection.length} 个节点` : "未选中节点";
      return;
    }
    const node = this.model.getNode(selection[0]);
    const definition = getActivityNodeDefinition(node.type);
    const title = document.createElement("div");
    title.className = "ng-editor-inspector-title";
    title.textContent = `${node.id} (${definition?.label || node.type})`;
    this.inspectorEl.appendChild(title);
    for (const valuePort of definition?.valueInputs || []) {
      const row = document.createElement("label");
      row.className = "ng-editor-inspector-row";
      const value = node.inputs?.[valuePort.name];
      row.innerHTML = `<span>${valuePort.name}</span>`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = value === undefined ? "" : JSON.stringify(value);
      input.addEventListener("change", () => {
        try {
          node.inputs[valuePort.name] = input.value === "" ? undefined : JSON.parse(input.value);
        } catch {
          node.inputs[valuePort.name] = input.value;
        }
      });
      row.appendChild(input);
      this.inspectorEl.appendChild(row);
    }
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "删除节点";
    deleteButton.addEventListener("click", () => {
      this.model.deleteNode(node.id);
      this.render();
    });
    this.inspectorEl.appendChild(deleteButton);
  }

  dispose() {
    this._dragPointer.cancel();
    this._connectionDragPointer.cancel();
    this._boxSelectPointer.cancel();
  }
}

function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

export default ActivityEditorView;
// DEV-TOOLS:END
