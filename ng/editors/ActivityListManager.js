// DEV-TOOLS:START
const clone = (value) => structuredClone(value);
const downloadJson = (fileName, value) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

export class ActivityListManager {
  constructor({ definitions, activityLists = [], onOpen = () => {}, onSave = () => {} } = {}) {
    this.definitions = definitions;
    this.activityLists = activityLists.length ? activityLists : [{ id: "default", displayName: "默认活动列表", activities: definitions.list().map((item) => item.id) }];
    this.onOpen = onOpen;
    this.onSave = onSave;
    this.root = null;
    this.selectedListId = this.activityLists[0]?.id || null;
    this.selectedActivityId = null;
  }
  mount(root) { this.root = root; this.render(); }
  render() {
    if (!this.root) return;
    const current = this.activityLists.find((item) => item.id === this.selectedListId) || this.activityLists[0];
    this.selectedListId = current?.id || null;
    this.root.innerHTML = `<div class="ng-activity-browser"><aside class="ng-activity-list-files"><header><h3>活动列表文件</h3><div><button data-al-new-file title="新建文件">＋</button><button data-al-copy-file title="复制文件">⧉</button><button data-al-delete-file title="删除文件">−</button><button data-al-download-file title="保存 JSON">💾</button></div></header><div data-al-files></div></aside><section class="ng-activity-list-activities"><header><h3 data-al-title></h3><div><button data-al-new-activity title="新建活动">＋</button><button data-al-copy-activity title="复制活动">⧉</button><button data-al-delete-activity title="删除活动">−</button><button data-al-download-activities title="保存 JSON">💾</button></div><div data-al-activities></div></section></div>`;
    const files = this.root.querySelector("[data-al-files]");
    for (const list of this.activityLists) {
      const row = document.createElement("div"); row.className = `ng-activity-file-row${list.id === this.selectedListId ? " selected" : ""}`;
      const select = document.createElement("button"); select.className = "ng-activity-file-name"; select.textContent = list.displayName || list.id; select.title = `${list.id}.json`; select.onclick = () => { this.selectedListId = list.id; this.render(); };
      const save = document.createElement("button"); save.className = "ng-activity-file-save"; save.textContent = "💾"; save.title = `保存 ${list.id}.json`; save.onclick = (event) => { event.stopPropagation(); this.onSave(clone(list)); };
      row.append(select, save); files.append(row);
    }
    this.root.querySelector("[data-al-new-file]").onclick = () => this.createFile();
    this.root.querySelector("[data-al-copy-file]").onclick = () => this.copyFile();
    this.root.querySelector("[data-al-delete-file]").onclick = () => this.deleteFile();
    this.root.querySelector("[data-al-download-file]").onclick = () => current && downloadJson(`${current.id}.json`, current);
    const title = this.root.querySelector("[data-al-title]");
    if (current) title.textContent = `${current.displayName || current.id}（${current.id}.json）`;
    const activities = this.root.querySelector("[data-al-activities]");
    const listedActivities = current?.activities || [];
    const activityItems = listedActivities.length ? listedActivities : this.definitions.list().map((definition) => definition.id);
    for (const item of activityItems) {
      const id = typeof item === "string" ? item : item?.id;
      const definition = this.definitions.get(id) || this.definitions.list().find((item) => item.id === id); if (!definition) continue;
      const row = document.createElement("button"); row.className = "ng-activity-entry"; row.innerHTML = `<b></b><small></small>`;
      row.querySelector("b").textContent = definition.displayName || definition.id; row.querySelector("small").textContent = definition.id;
      row.onclick = () => { this.selectedActivityId = definition.id; };
      row.ondblclick = () => { this.selectedActivityId = definition.id; this.onOpen(clone(definition)); }; activities.append(row);
    }
    this.root.querySelector("[data-al-new-activity]").onclick = () => this.createActivity();
    this.root.querySelector("[data-al-copy-activity]").onclick = () => this.copyActivity();
    this.root.querySelector("[data-al-delete-activity]").onclick = () => this.deleteActivity();
    this.root.querySelector("[data-al-download-activities]").onclick = () => {
      const definition = this.definitions.get(this.selectedActivityId) || this.definitions.list().find((item) => item.id === this.selectedActivityId);
      if (definition) downloadJson(`${definition.id}.json`, definition);
    };
    if (!activities.children.length) activities.innerHTML = "<p class=ng-activity-empty>此活动列表没有已加载的活动。</p>";
  }
  createFile() { let index = 1; while (this.activityLists.some((item) => item.id === `activity-list-${index}`)) index += 1; const list = { id: `activity-list-${index}`, displayName: `新活动列表 ${index}`, activities: [] }; this.activityLists.push(list); this.selectedListId = list.id; this.render(); }
  copyFile() { const source = this.activityLists.find((item) => item.id === this.selectedListId); if (!source) return; let index = 1; while (this.activityLists.some((item) => item.id === `${source.id}-copy-${index}`)) index += 1; const copy = clone(source); copy.id = `${source.id}-copy-${index}`; copy.displayName = `${source.displayName || source.id} 副本`; this.activityLists.push(copy); this.selectedListId = copy.id; this.render(); }
  deleteFile() { if (this.activityLists.length <= 1) return; const index = this.activityLists.findIndex((item) => item.id === this.selectedListId); if (index < 0) return; this.activityLists.splice(index, 1); this.selectedListId = this.activityLists[Math.max(0, index - 1)]?.id || null; this.render(); }
  createActivity() { const list = this.activityLists.find((item) => item.id === this.selectedListId); if (!list) return; let index = 1; while (this.definitions.get(`activity-${index}`)) index += 1; const id = `activity-${index}`; const definition = { id, displayName: `新活动 ${index}`, version: 1, entry: "start", nodes: [{ id: "start", type: "start", x: 80, y: 80, data: {} }, { id: "end", type: "end", x: 340, y: 80, data: {} }], connections: [{ id: "edge-1", from: { node: "start", port: "next" }, to: { node: "end", port: "in" } }] }; this.definitions.register(definition); list.activities.push({ id }); this.render(); this.onOpen(clone(definition)); }
  copyActivity() { const list = this.activityLists.find((item) => item.id === this.selectedListId); const id = list?.activities?.[0] && (typeof list.activities[0] === "string" ? list.activities[0] : list.activities[0].id); const source = this.definitions.get(id); if (!source) return; let index = 1; while (this.definitions.get(`${source.id}-copy-${index}`)) index += 1; const copy = clone(source); copy.id = `${source.id}-copy-${index}`; copy.displayName = `${source.displayName || source.id} 副本`; this.definitions.register(copy); list.activities.push({ id: copy.id }); this.render(); }
  deleteActivity() { const list = this.activityLists.find((item) => item.id === this.selectedListId); if (!list?.activities?.length) return; list.activities.pop(); this.render(); }
}
// DEV-TOOLS:END
