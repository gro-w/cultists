// DEV-TOOLS:START
import { t } from "../core/i18n/index.js";
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
    const node = { id, label: id, flowInputs: [{ name: "flowIn", kind: "flow" }], flowOutputs: [{ name: "flowOut", kind: "flow" }], valueInputs: [], valueOutputs: [], blueprint: starterBlueprint() };
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

  _saveNode(node, fields) {
    node.label = fields.label.value.trim() || node.id;
    try {
      node.flowInputs = JSON.parse(fields.flowInputs.value || "[]");
      node.flowOutputs = JSON.parse(fields.flowOutputs.value || "[]");
      node.valueInputs = JSON.parse(fields.valueInputs.value || "[]");
      node.valueOutputs = JSON.parse(fields.valueOutputs.value || "[]");
    } catch (error) {
      alert(`${t("legacy.0c870112c3ca")}JSON ${t("legacy.eb645ab4619f")}: ${error.message}`);
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
      this.detailEl.textContent = t("legacy.3b4e41b92a01");
      return;
    }
    this.detailEl.innerHTML = `
      <h3>${node.label || node.id}</h3>
      <label>${t("legacy.7f32e700e161")}<input data-field="label" value=""></label>
      <label>${t("legacy.c089e608a8b6")}<textarea data-field="flowInputs"></textarea></label>
      <label>${t("legacy.221ff1dcaa93")}<textarea data-field="flowOutputs"></textarea></label>
      <label>${t("legacy.acc9b9bec891")}<textarea data-field="valueInputs"></textarea></label>
      <label>${t("legacy.80ecc53ba8bf")}<textarea data-field="valueOutputs"></textarea></label>
      <div class="ng-list-manager-toolbar">
        <button type="button" data-action="save-memory">${t("legacy.b02ae67098e2")}</button>
        <button type="button" data-action="open">${t("legacy.fdc61e4938b6")}</button>
        <button type="button" data-action="download">${t("legacy.3f10b573ee1b")}JSON</button>
        <button type="button" data-action="write-disk">${t("legacy.81ee3266b03d")}</button>
      </div>
    `;
    const fields = Object.fromEntries([...this.detailEl.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field]));
    fields.label.value = node.label || node.id;
    for (const key of ["flowInputs", "flowOutputs", "valueInputs", "valueOutputs"]) fields[key].value = JSON.stringify(node[key] || [], null, 2);
    this.detailEl.querySelector('[data-action="save-memory"]').addEventListener("click", () => this._saveNode(node, fields));
    this.detailEl.querySelector('[data-action="open"]').addEventListener("click", () => this.openEditor(node));
    this.detailEl.querySelector('[data-action="download"]').addEventListener("click", () => downloadTextFile(`blueprint-node-${node.id}.json`, `${JSON.stringify(node, null, 2)}\n`));
    this.detailEl.querySelector('[data-action="write-disk"]').addEventListener("click", async () => {
      try { await writeDataFile("blueprint-nodes.framework.json", `${JSON.stringify(this.nodes, null, 2)}\n`); } catch (error) { alert(`${t("legacy.e92dc2256061")}: ${error.message}`); }
    });
  }
}

export default BlueprintNodeManagerView;
// DEV-TOOLS:END
