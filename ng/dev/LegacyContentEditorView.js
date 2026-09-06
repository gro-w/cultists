// DEV-TOOLS:START
import { downloadTextFile, writeDataFile } from "./devApi.js";

/** Generic fallback editor for legacy documents not yet normalized into a typed editor. */
export class LegacyContentEditorView {
  constructor({ contentDocumentStore, dataLoader }) {
    this.store = contentDocumentStore;
    this.dataLoader = dataLoader;
    this.selectedId = null;
    this.el = document.createElement("section");
    this.el.className = "ng-dev-content-editor";
    this.render();
  }

  render() {
    const entries = this.store.list();
    this.el.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = "旧引擎内容文档（通用编辑器）";
    this.el.append(title);
    const select = document.createElement("select");
    select.dataset.action = "select";
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.id} · ${entry.sourceFile}`;
      select.append(option);
    }
    this.selectedId = this.selectedId && entries.some((entry) => entry.id === this.selectedId) ? this.selectedId : entries[0]?.id;
    if (this.selectedId) select.value = this.selectedId;
    select.addEventListener("change", () => { this.selectedId = select.value; this.render(); });
    this.el.append(select);

    const textarea = document.createElement("textarea");
    textarea.dataset.action = "document";
    textarea.rows = 20;
    textarea.cols = 90;
    textarea.value = JSON.stringify(this.store.get(this.selectedId)?.document ?? null, null, 2);
    this.el.append(textarea);

    const status = document.createElement("output");
    status.dataset.action = "status";
    const buttonRow = document.createElement("div");
    for (const [label, action] of [["保存到内存", "memory"], ["下载 JSON", "download"], ["写入磁盘", "disk"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.action = action;
      button.addEventListener("click", async () => {
        try {
          const value = JSON.parse(textarea.value);
          this.store.replace(this.selectedId, value);
          if (action === "download") downloadTextFile(`${this.selectedId}.json`, `${JSON.stringify(value, null, 2)}\n`);
          if (action === "disk") {
            const entry = this.store.get(this.selectedId);
            await writeDataFile(entry.file, `${JSON.stringify(value, null, 2)}\n`);
            this.dataLoader.clearCache(entry.file);
          }
          status.textContent = action === "disk" ? "已写入磁盘" : "已更新内存";
        } catch (error) {
          status.textContent = `保存失败：${error.message}`;
        }
      });
      buttonRow.append(button);
    }
    this.el.append(buttonRow, status);
  }
}

export default LegacyContentEditorView;
// DEV-TOOLS:END
