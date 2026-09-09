// DEV-TOOLS:START
import { downloadTextFile, writeDataFile } from "./devApi.js";
import { registerCustomActivityNode, unregisterCustomActivityNode } from "../core/ActivityNodeRegistry.js";

function starterBlueprint() {
  return {
    startNodeId: "start",
    nodes: {
      start: { id: "start", type: "flowStart", x: 40, y: 40, inputs: {}, next: { flowOut: { nodeId: "end", port: "flowIn" } } },
      end: { id: "end", type: "activityEnd", x: 260, y: 40, inputs: {}, next: {} },
    },
  };
}

/** Developer editor for reusable, function-like blueprint macro nodes. */
export class BlueprintNodeManagerView {
  constructor({ nodes = [], openEditor } = {}) {
    this.nodes = nodes;
    this.openEditor = openEditor || (() => {});
    this.selectedId = null;
    this._buildDom();
    this.render();
  }

  _buildDom() {
    this.el = document.createElement("div");
    this.el.className = "ng-blueprint-node-manager";
    this.el.innerHTML = `
      <div class="ng-blueprint-node-manager-list">
        <div class="ng-list-manager-toolbar">
          <button type="button" data-action="new">新建蓝图节点</button>
          <button type="button" data-action="copy">复制</button>
          <button type="button" data-action="delete">删除</button>
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
    const id = prompt("蓝图节点 ID（只能使用字母、数字、下划线、冒号和短横线）:");
    if (!id || this.nodes.some((node) => node.id === id)) return;
    if (!/^[a-zA-Z][\w:-]*$/.test(id)) return alert("ID 格式无效");
    const node = { id, label: id, flowInputs: [{ name: "flowIn", kind: "flow" }], flowOutputs: [{ name: "flowOut", kind: "flow" }], valueInputs: [], valueOutputs: [], blueprint: starterBlueprint() };
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  copy() {
    const source = this.nodes.find((node) => node.id === this.selectedId);
    if (!source) return;
    const id = prompt("复制为:", `${source.id}-copy`);
    if (!id || this.nodes.some((node) => node.id === id)) return;
    const node = structuredClone({ ...source, id });
    this.nodes.push(node);
    registerCustomActivityNode(node);
    this.selectedId = id;
    this.render();
  }

  remove() {
    const index = this.nodes.findIndex((node) => node.id === this.selectedId);
    if (index < 0 || !confirm(`删除蓝图节点“${this.selectedId}”？`)) return;
    unregisterCustomActivityNode(this.selectedId);
    this.nodes.splice(index, 1);
    this.selectedId = null;
    this.render();
  }

  _saveNode(node, fields) {
    node.label = fields.label.value.trim() || node.id;
    try {
      node.flowInputs = JSON.parse(fields.flowInputs.value || "[]");
      node.flowOutputs = JSON.parse(fields.flowOutputs.value || "[]");
      node.valueInputs = JSON.parse(fields.valueInputs.value || "[]");
      node.valueOutputs = JSON.parse(fields.valueOutputs.value || "[]");
    } catch (error) {
      alert(`接口 JSON 无效: ${error.message}`);
      return false;
    }
    registerCustomActivityNode(node);
    this.render();
    return true;
  }

  render() {
    this.itemsEl.innerHTML = "";
    for (const node of this.nodes) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ng-list-manager-list-item";
      row.classList.toggle("selected", node.id === this.selectedId);
      row.textContent = `${node.label || node.id} (${node.id})`;
      row.addEventListener("click", () => { this.selectedId = node.id; this.render(); });
      this.itemsEl.appendChild(row);
    }
    const node = this.nodes.find((entry) => entry.id === this.selectedId);
    if (!node) {
      this.detailEl.textContent = "选择一个自定义蓝图节点，或新建一个节点";
      return;
    }
    this.detailEl.innerHTML = `
      <h3>${node.label || node.id}</h3>
      <label>显示名 <input data-field="label" value=""></label>
      <label>流程输入 <textarea data-field="flowInputs"></textarea></label>
      <label>流程输出 <textarea data-field="flowOutputs"></textarea></label>
      <label>数值输入 <textarea data-field="valueInputs"></textarea></label>
      <label>数值输出 <textarea data-field="valueOutputs"></textarea></label>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="save-memory">保存到内存</button>
        <button type="button" data-action="open">打开蓝图编辑器</button>
        <button type="button" data-action="download">下载 JSON</button>
        <button type="button" data-action="write-disk">写入磁盘</button>
      </div>
    `;
    const fields = Object.fromEntries([...this.detailEl.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field]));
    fields.label.value = node.label || node.id;
    for (const key of ["flowInputs", "flowOutputs", "valueInputs", "valueOutputs"]) fields[key].value = JSON.stringify(node[key] || [], null, 2);
    this.detailEl.querySelector('[data-action="save-memory"]').addEventListener("click", () => this._saveNode(node, fields));
    this.detailEl.querySelector('[data-action="open"]').addEventListener("click", () => this.openEditor(node));
    this.detailEl.querySelector('[data-action="download"]').addEventListener("click", () => downloadTextFile(`blueprint-node-${node.id}.json`, `${JSON.stringify(node, null, 2)}\n`));
    this.detailEl.querySelector('[data-action="write-disk"]').addEventListener("click", async () => {
      try { await writeDataFile("blueprint-nodes.json", `${JSON.stringify(this.nodes, null, 2)}\n`); } catch (error) { alert(`写入失败: ${error.message}`); }
    });
  }
}

export default BlueprintNodeManagerView;
// DEV-TOOLS:END
