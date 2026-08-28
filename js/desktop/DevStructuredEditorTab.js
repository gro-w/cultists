// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";

const EDITOR_CONFIGS = {
  "chatgtp-dialog": { file: "chatgtp_dialog.json", title: "ChatGTP 对话编辑器", description: "编辑 ChatGTP 对话蓝图及其稳定 ID。", fields: { id: "稳定 ID", name: "显示名称", blueprint: "对话蓝图（JSON）" } },
  "item-placements": { file: "item_placements.json", title: "场景物品摆放编辑器", description: "编辑物品在场景中的位置、区域、显示条件和拾取/放回提示。", fields: { placements: "摆放记录（JSON 数组）" } },
  diagnoses: { file: "diagnoses.json", title: "诊断知识编辑器", description: "编辑 ICD 分类、诊断名称、症状和适用/禁用药品关系。", fields: { lowSanThreshold: "低 SAN 阈值", categories: "ICD 分类与诊断（JSON 数组）" } },
  medicines: { file: "medicines.json", title: "药品知识编辑器", description: "编辑药品、价格、佣金、分类及其适用/禁用诊断关系。", fields: { medicines: "药品列表（JSON 数组）", categories: "药品分类（JSON 数组）" } },
  medical-events: { file: "medical_events.json", title: "医疗事件编辑器", description: "编辑投诉、暴动和诊断奖励，以及对应的医生对话。", fields: { complaintFine: "投诉罚款", riotFine: "暴动罚款", diagnosisBonus: "诊断奖励", complaintDialogues: "投诉对话（JSON 数组）", riotDialogues: "暴动对话（JSON 数组）" } },
  npc-state: { file: "npc_state.json", title: "NPC 状态规则编辑器", description: "编辑 NPC 默认 SAN、崩溃阈值、离线阈值和离线后果配置。", fields: { defaultSan: "默认 SAN", distressedThreshold: "不稳定阈值", offlineThreshold: "离线阈值", offlineConsequence: "离线后果（JSON）" } },
  time-rules: { file: "time_rules.json", title: "时间规则编辑器", description: "编辑阶段时长、睡眠恢复、睡眠债和熬夜 SAN 损失。20 分钟行动单位仍是引擎不变量。", fields: { day: "白天规则（JSON）", night: "夜间规则（JSON）", fullSleepMinutes: "完整睡眠分钟", insufficientSleepMinutes: "不足睡眠分钟", sanRecoveryPerSleepHour: "每睡眠小时 SAN 恢复", threeDaySleepDebtSanLoss: "三日睡眠债 SAN 损失", sanLossPerLateNightAction: "每次熬夜行动 SAN 损失" } },
  calendar: { file: "calendar.json", title: "日历规则编辑器", description: "编辑总天数、休息日和夜班日。", fields: { totalDays: "总天数", restDays: "休息日（JSON 数组）", nightDutyDays: "夜班日（JSON 数组）" } },
  achievements: { file: "achievements.json", title: "成就定义编辑器", description: "编辑成就标题、描述、图标、分类、隐藏状态和触发条件。", fields: { achievements: "成就列表（JSON 数组）", categories: "成就分类（JSON）" } },
  skills: { file: "skills.json", title: "技能定义编辑器", description: "编辑技能稳定 ID、显示名称和初始数值。", fields: { skills: "技能列表（JSON 数组）" } },
  monitor-scenes: { file: "monitor_scenes.json", title: "监控场景编辑器", description: "编辑白天/夜间监控画面及其场景记录。", fields: { day: "白天场景（JSON）", night: "夜间场景（JSON）" } },
};

const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const isStructured = (value) => value !== null && typeof value === "object";

export class DevStructuredEditorTab {
  constructor(devMode, key) {
    this._dev = devMode;
    this.key = key;
    this.config = EDITOR_CONFIGS[key];
    this.data = null;
  }

  static keys() { return Object.keys(EDITOR_CONFIGS); }
  static config(key) { return EDITOR_CONFIGS[key]; }

  html() {
    return `<div class="dev-structured-root"><div class="dev-structured-toolbar"><strong>${esc(this.config.title)}</strong><button type="button" class="win95-btn dev-btn" data-dev-action="structured-reload">⬇ 重新读取</button><button type="button" class="win95-btn dev-btn" data-dev-action="structured-save">💾 保存到内存</button><button type="button" class="win95-btn dev-btn" data-dev-action="structured-download">📤 下载 JSON</button><button type="button" class="win95-btn dev-btn" data-dev-action="structured-write">💽 写入磁盘</button></div><p class="dev-structured-description">${esc(this.config.description)} 文件：<code>${esc(this.config.file)}</code></p><div class="dev-structured-fields" data-structured-fields><p>加载中…</p></div></div>`;
  }

  mount() { this.reload(); }
  unmount() {}

  async reload() {
    try {
      this.data = JSON.parse(JSON.stringify(await dataLoader.loadJSON(this.config.file)));
      this.render();
      this._dev.setStatus(`${this.config.file} 已读取。`);
    } catch (error) {
      this._dev.setStatus(`${this.config.file} 读取失败：${error.message}`, true);
    }
  }

  render() {
    const container = this._dev.root.querySelector("[data-structured-fields]");
    if (!container || !this.data) return;
    container.innerHTML = Object.entries(this.config.fields).map(([key, label]) => {
      const value = this.data[key];
      if (isStructured(value)) {
        return `<label class="dev-structured-field"><span>${esc(label)}</span><textarea data-structured-field="${esc(key)}" class="dev-textarea" rows="${Array.isArray(value) ? 10 : 6}">${esc(JSON.stringify(value, null, 2))}</textarea></label>`;
      }
      const type = typeof value === "number" ? "number" : "text";
      return `<label class="dev-structured-field"><span>${esc(label)}</span><input data-structured-field="${esc(key)}" type="${type}" value="${esc(value)}"></label>`;
    }).join("");
  }

  _readForm() {
    const next = { ...this.data };
    this._dev.root.querySelectorAll("[data-structured-field]").forEach((element) => {
      const key = element.dataset.structuredField;
      if (element.tagName === "TEXTAREA") {
        try { next[key] = JSON.parse(element.value); }
        catch (error) { throw new Error(`${this.config.fields[key]}不是有效 JSON：${error.message}`); }
      } else if (element.type === "number") {
        const value = Number(element.value);
        if (!Number.isFinite(value)) throw new Error(`${this.config.fields[key]}必须是数字`);
        next[key] = value;
      } else {
        next[key] = element.value;
      }
    });
    return next;
  }

  _validate(value) {
    if (!isStructured(value)) throw new Error("文件顶层必须是对象");
    Object.keys(this.config.fields).forEach((key) => {
      if (!(key in value)) throw new Error(`缺少字段：${key}`);
    });
    if (this.key === "time-rules" && ["fullSleepMinutes", "insufficientSleepMinutes", "sanRecoveryPerSleepHour", "threeDaySleepDebtSanLoss", "sanLossPerLateNightAction"].some((key) => value[key] < 0)) throw new Error("时间规则不能为负数");
    if (this.key === "calendar" && (!Number.isInteger(value.totalDays) || value.totalDays < 1)) throw new Error("总天数必须是正整数");
    if (this.key === "npc-state" && ["defaultSan", "distressedThreshold", "offlineThreshold"].some((key) => value[key] < 0 || value[key] > 100)) throw new Error("NPC SAN 阈值必须在 0-100 之间");
    return value;
  }

  sync() { this.data = this._validate(this._readForm()); return this.data; }
  save() { this.sync(); dataLoader.clearCache(this.config.file); this._dev.setStatus(`${this.config.file} 已保存到内存。`); }
  download() { const value = this.sync(); this._dev.downloadFile(this.config.file, value); this._dev.setStatus(`${this.config.file} 已下载。`); }
  async write() { const value = this.sync(); await this._dev.writeToDisk(this.config.file, value); }
}
// DEV-TOOLS:END
