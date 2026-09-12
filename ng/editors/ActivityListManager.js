// DEV-TOOLS:START
const clone = (value) => structuredClone(value);
const downloadJson = (fileName, value) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

export class ScheduleListManager {
  constructor({ definitions, scheduleLists = [], onOpen = () => {}, onSave = () => {} } = {}) {
    this.definitions = definitions;
    this.scheduleLists = scheduleLists.length ? scheduleLists : [{ id: "default", displayName: "默认活动列表", schedules: definitions.list().map((item) => item.id) }];
    this.onOpen = onOpen;
    this.onSave = onSave;
    this.root = null;
    this.selectedListId = this.scheduleLists[0]?.id || null;
    this.selectedScheduleId = null;
  }
  mount(root) { this.root = root; this.render(); }
  render() {
    if (!this.root) return;
    const current = this.scheduleLists.find((item) => item.id === this.selectedListId) || this.scheduleLists[0];
    this.selectedListId = current?.id || null;
    this.root.innerHTML = `<div class="ng-schedule-browser"><aside class="ng-schedule-list-files"><header><h3>活动列表文件</h3><div><button data-al-new-file title="新建文件">＋</button><button data-al-copy-file title="复制文件">⧉</button><button data-al-delete-file title="删除文件">−</button><button data-al-download-file title="保存 JSON">💾</button></div></header><div data-al-files></div></aside><section class="ng-schedule-list-schedules"><header><h3 data-al-title></h3><div><button data-al-new-schedule title="新建活动">＋</button><button data-al-copy-schedule title="复制活动">⧉</button><button data-al-delete-schedule title="删除活动">−</button><button data-al-download-schedules title="保存 JSON">💾</button></div><div data-al-schedules></div></section></div>`;
    const files = this.root.querySelector("[data-al-files]");
    for (const list of this.scheduleLists) {
      const row = document.createElement("div"); row.className = `ng-schedule-file-row${list.id === this.selectedListId ? " selected" : ""}`;
      const select = document.createElement("button"); select.className = "ng-schedule-file-name"; select.textContent = list.displayName || list.id; select.title = `${list.id}.json`; select.onclick = () => { this.selectedListId = list.id; this.render(); };
      const save = document.createElement("button"); save.className = "ng-schedule-file-save"; save.textContent = "💾"; save.title = `保存 ${list.id}.json`; save.onclick = (event) => { event.stopPropagation(); this.onSave(clone(list)); };
      row.append(select, save); files.append(row);
    }
    this.root.querySelector("[data-al-new-file]").onclick = () => this.createFile();
    this.root.querySelector("[data-al-copy-file]").onclick = () => this.copyFile();
    this.root.querySelector("[data-al-delete-file]").onclick = () => this.deleteFile();
    this.root.querySelector("[data-al-download-file]").onclick = () => current && downloadJson(`${current.id}.json`, current);
    const title = this.root.querySelector("[data-al-title]");
    if (current) title.textContent = `${current.displayName || current.id}（${current.id}.json）`;
    const schedules = this.root.querySelector("[data-al-schedules]");
    const listedSchedules = current?.schedules || [];
    const scheduleItems = listedSchedules.length ? listedSchedules : this.definitions.list().map((definition) => definition.id);
    for (const item of scheduleItems) {
      const id = typeof item === "string" ? item : item?.id;
      const definition = this.definitions.get(id) || this.definitions.list().find((item) => item.id === id); if (!definition) continue;
      const row = document.createElement("button"); row.className = "ng-schedule-entry"; row.innerHTML = `<b></b><small></small>`;
      row.querySelector("b").textContent = definition.displayName || definition.id; row.querySelector("small").textContent = definition.id;
      row.onclick = () => { this.selectedScheduleId = definition.id; };
      row.ondblclick = () => { this.selectedScheduleId = definition.id; this.onOpen(clone(definition)); }; schedules.append(row);
    }
    this.root.querySelector("[data-al-new-schedule]").onclick = () => this.createSchedule();
    this.root.querySelector("[data-al-copy-schedule]").onclick = () => this.copySchedule();
    this.root.querySelector("[data-al-delete-schedule]").onclick = () => this.deleteSchedule();
    this.root.querySelector("[data-al-download-schedules]").onclick = () => {
      const definition = this.definitions.get(this.selectedScheduleId) || this.definitions.list().find((item) => item.id === this.selectedScheduleId);
      if (definition) downloadJson(`${definition.id}.json`, definition);
    };
    if (!schedules.children.length) schedules.innerHTML = "<p class=ng-schedule-empty>此活动列表没有已加载的活动。</p>";
  }
  createFile() { let index = 1; while (this.scheduleLists.some((item) => item.id === `schedule-list-${index}`)) index += 1; const list = { id: `schedule-list-${index}`, displayName: `新活动列表 ${index}`, schedules: [] }; this.scheduleLists.push(list); this.selectedListId = list.id; this.render(); }
  copyFile() { const source = this.scheduleLists.find((item) => item.id === this.selectedListId); if (!source) return; let index = 1; while (this.scheduleLists.some((item) => item.id === `${source.id}-copy-${index}`)) index += 1; const copy = clone(source); copy.id = `${source.id}-copy-${index}`; copy.displayName = `${source.displayName || source.id} 副本`; this.scheduleLists.push(copy); this.selectedListId = copy.id; this.render(); }
  deleteFile() { if (this.scheduleLists.length <= 1) return; const index = this.scheduleLists.findIndex((item) => item.id === this.selectedListId); if (index < 0) return; this.scheduleLists.splice(index, 1); this.selectedListId = this.scheduleLists[Math.max(0, index - 1)]?.id || null; this.render(); }
  createSchedule() { const list = this.scheduleLists.find((item) => item.id === this.selectedListId); if (!list) return; let index = 1; while (this.definitions.get(`schedule-${index}`)) index += 1; const id = `schedule-${index}`; const definition = { id, displayName: `新活动 ${index}`, version: 1, entry: "start", nodes: [{ id: "start", type: "start", x: 80, y: 80, data: {} }, { id: "end", type: "end", x: 340, y: 80, data: {} }], connections: [{ id: "edge-1", from: { node: "start", port: "next" }, to: { node: "end", port: "in" } }] }; this.definitions.register(definition); list.schedules.push({ id }); this.render(); this.onOpen(clone(definition)); }
  copySchedule() { const list = this.scheduleLists.find((item) => item.id === this.selectedListId); const id = list?.schedules?.[0] && (typeof list.schedules[0] === "string" ? list.schedules[0] : list.schedules[0].id); const source = this.definitions.get(id); if (!source) return; let index = 1; while (this.definitions.get(`${source.id}-copy-${index}`)) index += 1; const copy = clone(source); copy.id = `${source.id}-copy-${index}`; copy.displayName = `${source.displayName || source.id} 副本`; this.definitions.register(copy); list.schedules.push({ id: copy.id }); this.render(); }
  deleteSchedule() { const list = this.scheduleLists.find((item) => item.id === this.selectedListId); if (!list?.schedules?.length) return; list.schedules.pop(); this.render(); }
}
// DEV-TOOLS:END
