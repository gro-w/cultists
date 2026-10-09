// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
import { downloadTextFile, writeDataFile } from "./devApi.js";
import { registerCustomActivityNode, unregisterCustomActivityNode, updateCustomActivityNode } from "../core/ActivityNodeRegistry.js";

function starterBlueprint(kind = "flow") {
  if (kind === "value") {
    return {
      nodes: {
        result: { id: "result", type: "valueReceiver", x: 260, y: 40, inputs: { value: null }, next: {} },
      },
    };
  }
  return {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {}, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", x: 260, y: 40, inputs: { port: "default" }, next: {} },
    },
  };
}

/** Developer editor for reusable, function-like blueprint macro nodes. */
export class BlueprintNodeManagerView {
  constructor({ nodes = [], dataFileName = "blueprint-nodes.json", dataLoader, openEditor } = {}) {
    this.nodes = nodes;
    this.dataFileName = dataFileName;
    this.dataLoader = dataLoader || null;
    this.openEditor = openEditor || (() => {});
    this.selectedId = null;
    this.draft = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-blueprint-node-manager";
    this.el.innerHTML = `
      <div class="ng-blueprint-node-manager-list">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new">${t("legacy.41f289b10d18")}</button>
          <button type="button" data-action="copy">${t("legacy.4edd1d00875d")}</button>
          <button type="button" data-action="delete">${t("legacy.3755f56f2f83")}</button>
        </div>
        <div data-role="items"></div>
      </div>
      <div class="ng-blueprint-node-manager-detail" data-role="detail"></div>
    `;
    this.itemsEl = this.el.querySelector('[data-role="items"]');
    this.detailEl = this.el.querySelector('[data-role="detail"]');
    this.el.querySelector('[data-action="new"]').addEventListener("click", () => this.create());
    this.el.querySelector('[data-action="copy"]').addEventListener("click", () => this.copy());
    this.el.querySelector('[data-action="delete"]').addEventListener("click", () => this.remove());
  }

  create() {
    const id = prompt(t("legacy.8cb077e8d362"));
    if (!id || this.nodes.some((node) => node.id === id)) return;
    if (!/^[a-zA-Z][\w:-]*$/.test(id)) return alert(t("legacy.b28a0976574b"));
    const node = { id, label: id, flowInputs: [{ name: "flowIn", kind: "flow" }], flowOutputs: [{ name: "flowOut", kind: "flow" }], valueInputs: [], valueOutputs: [], blueprint: starterBlueprint("flow") };
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  copy() {
    const source = this.nodes.find((node) => node.id === this.selectedId);
    if (!source) return;
    const id = prompt(t("legacy.9489917637a8"), `${source.id}-copy`);
    if (!id || this.nodes.some((node) => node.id === id)) return;
    const node = structuredClone({ ...source, id });
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  remove() {
    const index = this.nodes.findIndex((node) => node.id === this.selectedId);
    if (index < 0 || !confirm(`${t("legacy.4565f561c5e7")}${this.selectedId}”？`)) return;
    unregisterCustomActivityNode(this.selectedId);
    this.nodes.splice(index, 1);
    this.selectedId = null;
    this.render();
  }

  openBlueprintEditor(nodeOrId = this.selectedId) {
    const node = typeof nodeOrId === "string"
      ? this.nodes.find((entry) => entry.id === nodeOrId)
      : nodeOrId;
    if (!node) return false;
    if (this.selectedId === node.id && this.detailEl?.querySelector('[data-field="label"]') && !this._saveNode(node)) return false;
    this.openEditor(node, (blueprint) => {
      const next = { ...structuredClone(node), blueprint: structuredClone(blueprint) };
      try {
        updateCustomActivityNode(next);
      } catch (error) {
        alert(`${t("legacy.0c870112c3ca")}: ${error.message}`);
        return false;
      }
      Object.assign(node, next);
      this.draft = null;
      this.render();
      return true;
    });
    return true;
  }

  _getDraft(node) {
    if (this.draft?.id !== node.id) this.draft = structuredClone(node);
    return this.draft;
  }

  _readDraftFromInspector(node) {
    const draft = this._getDraft(node);
    draft.label = this.detailEl.querySelector('[data-field="label"]').value.trim() || node.id;
    draft.description = this.detailEl.querySelector('[data-field="description"]').value.trim();
    for (const key of ["flowInputs", "flowOutputs", "valueInputs", "valueOutputs"]) {
      draft[key] = [...this.detailEl.querySelectorAll(`[data-port-group="${key}"] [data-port-row]`)].map((row, index) => {
        const port = structuredClone(draft[key]?.[index] || this._newPort(draft, key));
        port.name = row.querySelector('[data-port-field="name"]').value.trim();
        if (key.startsWith("flow")) {
          port.kind = "flow";
          delete port.type;
        } else {
          port.kind = "value";
          port.type = row.querySelector('[data-port-field="type"]').value;
        }
        return port;
      });
    }
    return draft;
  }

  _uniquePortName(node, key) {
    const base = ({ flowOutputs: "flowOut", valueInputs: "input", valueOutputs: "value" })[key] || "flowIn";
    const peerKey = key === "flowOutputs" ? "valueOutputs" : key === "valueOutputs" ? "flowOutputs" : "flowInputs";
    const used = new Set([...(node[key] || []), ...(node[peerKey] || [])].map(({ name }) => name));
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}${suffix}`)) suffix += 1;
    return `${base}${suffix}`;
  }

  _newPort(node, key) {
    if (key.startsWith("flow")) return { name: this._uniquePortName(node, key), kind: "flow" };
    const port = { name: this._uniquePortName(node, key), kind: "value", type: "any" };
    if (key === "valueOutputs") port.receiverId = `__output_${port.name}`;
    return port;
  }

  _syncValueOutputReceivers(node) {
    node.blueprint ||= { nodes: {} };
    node.blueprint.nodes ||= {};
    const receiverIds = new Set();
    for (const [index, output] of node.valueOutputs.entries()) {
      let receiverId = output.receiverId;
      if (!receiverId || receiverIds.has(receiverId)
        || (node.blueprint.nodes[receiverId] && node.blueprint.nodes[receiverId].type !== "valueReceiver")) {
        const safeName = output.name.replace(/[^A-Za-z0-9_-]/g, "_");
        receiverId = `__output_${safeName}`;
        let suffix = 2;
        while (receiverIds.has(receiverId) || node.blueprint.nodes[receiverId]) receiverId = `__output_${safeName}_${suffix++}`;
        output.receiverId = receiverId;
      }
      receiverIds.add(receiverId);
      const receiver = node.blueprint.nodes[receiverId] || {
        id: receiverId,
        type: "valueReceiver",
        x: 260,
        y: 40 + index * 110,
        inputs: {},
        next: {},
      };
      receiver.inputs ||= {};
      if (!Object.prototype.hasOwnProperty.call(receiver.inputs, "value")) receiver.inputs.value = null;
      node.blueprint.nodes[receiverId] = receiver;
    }
    for (const [receiverId, receiver] of Object.entries(node.blueprint.nodes)) {
      if (receiver.type === "valueReceiver" && !receiverIds.has(receiverId)) delete node.blueprint.nodes[receiverId];
    }
  }

  _reconcileFlowReturnPorts(previousPorts, node) {
    const nextPorts = node.flowOutputs || [];
    for (const end of Object.values(node.blueprint?.nodes || {})) {
      if (end.type !== "activityEnd" && end.type !== "macroReturn") continue;
      const rawPort = String(end.inputs?.port ?? "default");
      if (rawPort === "default") continue;
      const oldIndex = previousPorts.findIndex(({ name }) => name === rawPort);
      const index = oldIndex >= 0 ? oldIndex : (/^\d+$/.test(rawPort) ? Number(rawPort) - 1 : -1);
      if (index < 0 || !previousPorts[index]) {
        if (!nextPorts.some(({ name }) => name === rawPort)) end.inputs.port = "default";
        continue;
      }
      const nextIndex = nextPorts.findIndex(({ name }) => name === previousPorts[index].name);
      end.inputs.port = nextIndex < 0 ? "default" : String(nextIndex + 1);
    }
  }

  _changeKind(node, kind) {
    const draft = this._readDraftFromInspector(node);
    const currentKind = draft.valueOutputs.length ? "value" : "flow";
    if (kind === currentKind) return;
    if (!confirm("切换节点类型会重置内部蓝图结构与引脚，是否继续？")) {
      this.detailEl.querySelector('[data-field="kind"]').value = currentKind;
      return;
    }
    const valueInputs = structuredClone(draft.valueInputs || []);
    if (kind === "flow") {
      Object.assign(draft, {
        flowInputs: [{ name: "flowIn", kind: "flow" }],
        flowOutputs: [{ name: "flowOut", kind: "flow" }],
        valueInputs,
        valueOutputs: [],
        blueprint: starterBlueprint("flow"),
      });
    } else {
      Object.assign(draft, {
        flowInputs: [],
        flowOutputs: [],
        valueInputs,
        valueOutputs: [{ name: "value", kind: "value", type: "any", receiverId: "result" }],
        blueprint: starterBlueprint("value"),
      });
    }
    this.render();
  }

  _addPin(node, key) {
    const draft = this._readDraftFromInspector(node);
    const port = this._newPort(draft, key);
    draft[key].push(port);
    if (key === "valueOutputs") {
      draft.blueprint.nodes[port.receiverId] = {
        id: port.receiverId,
        type: "valueReceiver",
        x: 260,
        y: 40 + (draft.valueOutputs.length - 1) * 110,
        inputs: { value: null },
        next: {},
      };
    }
    this.render();
  }

  _removePin(node, key, index) {
    if (key === "flowInputs") return;
    const draft = this._readDraftFromInspector(node);
    if (key === "valueOutputs" && draft.valueOutputs.length <= 1) return;
    const previousPorts = structuredClone(draft[key]);
    draft[key].splice(index, 1);
    if (key === "flowOutputs") this._reconcileFlowReturnPorts(previousPorts, draft);
    if (key === "valueOutputs") this._syncValueOutputReceivers(draft);
    this.render();
  }

  _saveNode(node) {
    const next = this._readDraftFromInspector(node);
    const isValue = next.valueOutputs.length > 0;
    if (isValue) {
      next.flowInputs = [];
      next.flowOutputs = [];
      this._syncValueOutputReceivers(next);
    } else {
      next.valueOutputs = [];
      if (node.valueOutputs?.length) next.blueprint = starterBlueprint("flow");
      else this._reconcileFlowReturnPorts(node.flowOutputs || [], next);
      if (next.flowInputs.length !== 1) next.flowInputs = [{ name: "flowIn", kind: "flow" }];
    }
    for (const [left, right] of [["flowInputs", "valueInputs"], ["flowOutputs", "valueOutputs"]]) {
      const ports = [...next[left], ...next[right]];
      const names = ports.map(({ name }) => name);
      if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) || new Set(names).size !== names.length) {
        alert(`${t("legacy.0c870112c3ca")} ${left}/${right}: ${t("legacy.b28a0976574b")}`);
        return false;
      }
    }
    try {
      updateCustomActivityNode(next);
    } catch (error) {
      alert(`${t("legacy.0c870112c3ca")}: ${error.message}`);
      return false;
    }
    Object.assign(node, next);
    this.draft = null;
    this.render();
    return true;
  }

  async _writeToDisk(node) {
    if (!this._saveNode(node)) return;
    try {
      const text = JSON.stringify(this.nodes, null, 2) + String.fromCharCode(10);
      await writeDataFile(this.dataFileName, text);
      if (this.dataLoader) {
        const saved = await this.dataLoader.loadJSON(this.dataFileName, { cache: false });
        if (JSON.stringify(saved) !== JSON.stringify(this.nodes)) throw new Error("read-back did not match the edited node list");
      }
      this.statusEl.textContent = t("legacy.d4371481b26a");
    } catch (error) {
      this.statusEl.textContent = `${t("legacy.e92dc2256061")}: ${error.message}`;
    }
  }

  _renderPortGroup(node, key, title, { canAdd = false, canRemove = true } = {}) {
    const group = document.createElement("section");
    group.className = "ng-blueprint-node-port-group";
    group.dataset.portGroup = key;
    const toolbar = document.createElement("div");
    toolbar.className = "ng-blueprint-node-port-group-heading";
    const heading = document.createElement("h4");
    heading.textContent = title;
    toolbar.appendChild(heading);
    if (canAdd) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "ng-blueprint-node-pin-add";
      add.textContent = "+";
      add.title = t("blueprintNodeManager.addPin", "添加引脚");
      add.setAttribute("aria-label", `${t("blueprintNodeManager.addPin", "添加")} ${title}`);
      add.addEventListener("click", () => this._addPin(this.nodes.find((entry) => entry.id === this.selectedId), key));
      toolbar.appendChild(add);
    }
    group.appendChild(toolbar);
    const rows = document.createElement("div");
    (node[key] || []).forEach((port, index) => rows.appendChild(this._portRow(node, key, port, index, canRemove)));
    group.appendChild(rows);
    return group;
  }

  _portRow(node, key, port, index, canRemove) {
    const row = document.createElement("div");
    row.className = `ng-blueprint-node-port-row ${key.startsWith("flow") ? "flow" : "value"}`;
    row.dataset.portRow = "";
    row.dataset.portIndex = String(index);
    row.dataset.portGroup = key;
    const pin = document.createElement("span");
    pin.className = "ng-blueprint-node-pin-socket";
    pin.setAttribute("aria-hidden", "true");
    row.appendChild(pin);
    const name = document.createElement("input");
    name.type = "text";
    name.dataset.portField = "name";
    name.setAttribute("aria-label", `${key} name`);
    name.value = port.name || "";
    row.appendChild(name);
    if (!key.startsWith("flow")) {
      const type = document.createElement("select");
      type.dataset.portField = "type";
      type.setAttribute("aria-label", `${key} type`);
      for (const value of ["any", "string", "number", "bool", "object", "array"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        type.appendChild(option);
      }
      type.value = port.type || "any";
      row.appendChild(type);
    }
    if (canRemove) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ng-blueprint-node-pin-remove";
      remove.type = "button";
      remove.textContent = "−";
      remove.title = t("blueprintNodeManager.removePin", "移除此引脚");
      remove.setAttribute("aria-label", `${t("blueprintNodeManager.removePin", "移除引脚")} ${port.name}`);
      remove.disabled = key === "valueOutputs" && node.valueOutputs.length <= 1;
      remove.addEventListener("click", () => this._removePin(this.nodes.find((entry) => entry.id === this.selectedId), key, index));
      row.appendChild(remove);
    }
    return row;
  }

  _renderNodeVisual(node) {
    const visual = document.createElement("div");
    visual.className = "ng-blueprint-node-visual";
    const inputs = document.createElement("div");
    inputs.className = "ng-blueprint-node-visual-side inputs";
    const core = document.createElement("div");
    core.className = "ng-blueprint-node-visual-core";
    const title = document.createElement("strong");
    title.className = "ng-blueprint-node-visual-title";
    title.textContent = node.label || node.id;
    const kind = document.createElement("span");
    kind.className = "ng-blueprint-node-visual-kind";
    kind.textContent = node.valueOutputs.length ? "数值节点" : "流程节点";
    const id = document.createElement("small");
    id.textContent = node.id;
    core.append(title, kind, id);
    const outputs = document.createElement("div");
    outputs.className = "ng-blueprint-node-visual-side outputs";
    if (node.flowInputs.length) inputs.appendChild(this._renderPortGroup(node, "flowInputs", "流程输入", { canRemove: false }));
    inputs.appendChild(this._renderPortGroup(node, "valueInputs", "数值输入", { canAdd: true }));
    if (node.flowOutputs.length || !node.valueOutputs.length) outputs.appendChild(this._renderPortGroup(node, "flowOutputs", "流程输出", { canAdd: true }));
    if (node.valueOutputs.length) outputs.appendChild(this._renderPortGroup(node, "valueOutputs", "数值输出", { canAdd: true }));
    visual.append(inputs, core, outputs);
    return visual;
  }

  render() {
    this.itemsEl.innerHTML = "";
    for (const node of this.nodes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ng-list-manager-list-item";
      row.classList.toggle("selected", node.id === this.selectedId);
      row.textContent = `${node.label || node.id} (${node.id})`;
      row.addEventListener("click", () => {
        if (this.draft && this.draft.id === this.selectedId) {
          const current = this.nodes.find((entry) => entry.id === this.selectedId);
          if (current && this.detailEl?.querySelector('[data-field="label"]')) this._readDraftFromInspector(current);
          if (current && JSON.stringify(this.draft) !== JSON.stringify(current)
            && !confirm(t("blueprintNodeManager.discardChanges", "当前节点有未保存修改，切换后会丢弃。继续？"))) return;
        }
        this.selectedId = node.id;
        this.draft = null;
        this.render();
      });
      this.itemsEl.appendChild(row);
    }
    const node = this.nodes.find((entry) => entry.id === this.selectedId);
    if (!node) {
      this.draft = null;
      this.detailEl.textContent = t("legacy.3b4e41b92a01");
      return;
    }
    const draft = this._getDraft(node);
    this.detailEl.innerHTML = `
      <label>${t("legacy.7f32e700e161")}<input data-field="label" value=""></label>
      <label>Description<textarea data-field="description"></textarea></label>
      <label>${t("blueprintNodeManager.kind", "节点类型")}<select data-field="kind"><option value="flow">${t("blueprintNodeManager.flowNode", "流程节点")}</option><option value="value">${t("blueprintNodeManager.valueNode", "数值节点")}</option></select></label>
      <div data-role="node-visual"></div>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="save-memory">${t("legacy.b02ae67098e2")}</button>
        <button type="button" data-action="open">${t("blueprintNodeManager.editBlueprint", "编辑节点蓝图")}</button>
        <button type="button" data-action="download">${t("legacy.3f10b573ee1b")}JSON</button>
        <button type="button" data-action="write-disk">${t("legacy.81ee3266b03d")}</button>
      </div>
      <div class="ng-editor-status" aria-live="polite"></div>
    `;
    const labelInput = this.detailEl.querySelector('[data-field="label"]');
    labelInput.value = draft.label || node.id;
    this.detailEl.querySelector('[data-field="description"]').value = draft.description || "";
    const kindSelect = this.detailEl.querySelector('[data-field="kind"]');
    kindSelect.value = draft.valueOutputs.length ? "value" : "flow";
    kindSelect.addEventListener("change", () => this._changeKind(node, kindSelect.value));
    this.statusEl = this.detailEl.querySelector(".ng-editor-status");
    const visualHost = this.detailEl.querySelector('[data-role="node-visual"]');
    visualHost.appendChild(this._renderNodeVisual(draft));
    labelInput.addEventListener("input", () => {
      const title = visualHost.querySelector(".ng-blueprint-node-visual-title");
      if (title) title.textContent = labelInput.value || node.id;
    });
    this.detailEl.querySelector('[data-action="save-memory"]').addEventListener("click", () => this._saveNode(node));
    this.detailEl.querySelector('[data-action="open"]').addEventListener("click", () => this.openBlueprintEditor(node));
    this.detailEl.querySelector('[data-action="download"]').addEventListener("click", () => {
      if (this._saveNode(node)) downloadTextFile(`blueprint-node-${node.id}.json`, JSON.stringify(node, null, 2) + String.fromCharCode(10));
    });
    this.detailEl.querySelector('[data-action="write-disk"]').addEventListener("click", async () => {
      await this._writeToDisk(node);
    });
  }
}

export default BlueprintNodeManagerView;
// DEV-TOOLS:END
