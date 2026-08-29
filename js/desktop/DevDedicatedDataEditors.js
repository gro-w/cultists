// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const input = (label, key, value, type = "text", extra = "") => `<label class="dev-ded-field"><span>${esc(label)}</span><input data-dd-field="${esc(key)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const checkbox = (label, key, checked) => `<label class="dev-ded-check"><input data-dd-field="${esc(key)}" type="checkbox" ${checked ? "checked" : ""}>${esc(label)}</label>`;

const btn = (text, action, value = "") => `<button type="button" class="win95-btn dev-btn" data-dd-action="${action}" data-dd-value="${esc(value)}">${text}</button>`;
const num = (label, key, value, extra = "") => input(label, key, value, "number", extra);

class DedicatedEditor {
  constructor(dev, file, title, description) { this.dev = dev; this.file = file; this.title = title; this.description = description; this.data = null; }
  html() { return `<div class="dev-ded-root"><header class="dev-ded-header"><strong>${esc(this.title)}</strong><span>${esc(this.description)}</span><div>${btn("重新读取", "reload")} ${btn("保存到内存", "save")} ${btn("下载文件", "download")} ${btn("写入磁盘", "write")}</div></header><div data-dd-content><p>加载中…</p></div></div>`; }
  async mount() { try { this.data = clone(await dataLoader.loadJSON(this.file)); this.render(); this.status(`${this.file} 已读取。`); } catch (e) { this.status(`${this.file} 读取失败：${e.message}`, true); } }
  status(text, error = false) { this.dev.setStatus(text, error); }
  root() { return this.dev.root.querySelector("[data-dd-content]"); }
  value(key) { const e = this.dev.root.querySelector(`[data-dd-field="${CSS.escape(key)}"]`); if (!e) return ""; return e.type === "checkbox" ? e.checked : e.value; }
  sync() {}
  save() { this.sync(); dataLoader.clearCache(this.file); this.status(`${this.file} 已保存到内存。`); }
  download() { this.sync(); this.dev.downloadFile(this.file, this.data); this.status(`${this.file} 已下载。`); }
  async write() { this.sync(); await this.dev.writeToDisk(this.file, this.data); }
  async reload() { await this.mount(); }
}


export class ItemPlacementsEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "item_placements.json", "场景物品摆放编辑器", "编辑物品、地点、条件和场景热点"); }
  render() { const rows = this.data.placements || (this.data.placements = []); this.root().innerHTML = `<div class="dev-ded-toolbar">${btn("＋ 添加摆放", "add-placement")}</div>${rows.map((p, i) => `<article class="dev-ded-card"><div class="dev-ded-card-title"><b>摆放项 ${i + 1}</b>${btn("− 删除", "remove-placement", i)}</div><div class="dev-ded-grid">${input("摆放 ID", `p.${i}.id`, p.id)} ${input("物品 ID", `p.${i}.itemId`, p.itemId)} ${input("地点 ID", `p.${i}.location`, p.location)} ${input("区域 ID", `p.${i}.zone`, p.zone)}</div><div class="dev-ded-grid">${checkbox("室友睡觉时显示", `p.${i}.sleeping`, p.condition?.roommatesSleeping)} ${input("热点图标", `p.${i}.icon`, p.hotspot?.icon)} ${input("热点标签", `p.${i}.label`, p.hotspot?.label)}</div>${input("拾取提示", `p.${i}.take`, p.takeMessage)} ${input("放回提示", `p.${i}.return`, p.returnMessage)}</article>`).join("") || "<p>暂无摆放项。</p>"}`; }
  sync() { (this.data.placements || []).forEach((p, i) => { p.id = this.value(`p.${i}.id`).trim(); p.itemId = this.value(`p.${i}.itemId`).trim(); p.location = this.value(`p.${i}.location`).trim(); p.zone = this.value(`p.${i}.zone`).trim(); p.condition = { ...(p.condition || {}), roommatesSleeping: this.value(`p.${i}.sleeping`) }; p.hotspot = { ...(p.hotspot || {}), icon: this.value(`p.${i}.icon`), label: this.value(`p.${i}.label`) }; p.takeMessage = this.value(`p.${i}.take`); p.returnMessage = this.value(`p.${i}.return`); }); }
  addPlacement() { this.data.placements.push({ id: `placement_${this.data.placements.length + 1}`, itemId: "", location: "dorm", zone: "", condition: {}, hotspot: { icon: "📦", label: "" }, takeMessage: "", returnMessage: "" }); this.render(); }
  removePlacement(i) { this.data.placements.splice(Number(i), 1); this.render(); }
}

export class DiagnosesEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "diagnoses.json", "诊断知识编辑器", "编辑 ICD 分类、诊断名称和药品/症状关联"); }
  render() { const cats = this.data.categories || (this.data.categories = []); this.root().innerHTML = `${num("低 SAN 阈值", "lowSanThreshold", this.data.lowSanThreshold, "min=0 max=100")}${btn("＋ 添加分类", "add-category")}${cats.map((c, ci) => `<article class="dev-ded-card"><div class="dev-ded-card-title"><b>ICD 分类 ${ci + 1}</b>${btn("− 删除分类", "remove-category", ci)}</div><div class="dev-ded-grid">${input("分类 ID", `c.${ci}.id`, c.id)} ${input("章节", `c.${ci}.chapter`, c.icdChapter)} ${input("编码范围", `c.${ci}.range`, c.icdRange)} ${input("分类名称", `c.${ci}.name`, c.name)}</div><div class="dev-ded-subtitle">诊断列表 ${btn("＋ 添加诊断", "add-diagnosis", ci)}</div>${(c.diagnoses || []).map((d, di) => `<div class="dev-ded-card nested"><div class="dev-ded-card-title"><b>${esc(d.id || "未命名诊断")}</b>${btn("−", "remove-diagnosis", `${ci}:${di}`)}</div><div class="dev-ded-grid">${input("诊断 ID", `d.${ci}.${di}.id`, d.id)} ${input("ICD-10", `d.${ci}.${di}.icd10`, d.icd10)} ${input("正常名称", `d.${ci}.${di}.normal`, d.normalName)} ${input("低 SAN 名称", `d.${ci}.${di}.low`, d.lowSanName)}</div><div class="dev-ded-tags"><label>症状 ID（每行一个）</label><div>${(d.symptomIds || []).map((x, k) => `<div class="dev-ded-inline">${input("症状", `d.${ci}.${di}.symptom.${k}`, x)}${btn("−", "remove-tag", `${ci}:${di}:symptom:${k}`)}</div>`).join("")}</div>${btn("＋ 添加症状", "add-tag", `${ci}:${di}:symptom`)}</div></div>`).join("")}</article>`).join("")}`; }
  sync() { this.data.lowSanThreshold = Number(this.value("lowSanThreshold")); (this.data.categories || []).forEach((c, ci) => { c.id = this.value(`c.${ci}.id`); c.icdChapter = this.value(`c.${ci}.chapter`); c.icdRange = this.value(`c.${ci}.range`); c.name = this.value(`c.${ci}.name`); (c.diagnoses || []).forEach((d, di) => { d.id = this.value(`d.${ci}.${di}.id`); d.icd10 = this.value(`d.${ci}.${di}.icd10`); d.normalName = this.value(`d.${ci}.${di}.normal`); d.lowSanName = this.value(`d.${ci}.${di}.low`); (d.symptomIds || []).forEach((_, k) => d.symptomIds[k] = this.value(`d.${ci}.${di}.symptom.${k}`)); }); }); }
  addCategory() { this.data.categories.push({ id: `category_${this.data.categories.length + 1}`, diagnoses: [] }); this.render(); }
  removeCategory(i) { this.data.categories.splice(Number(i), 1); this.render(); }
  addDiagnosis(ci) { this.data.categories[ci].diagnoses ||= []; this.data.categories[ci].diagnoses.push({ id: `diagnosis_${this.data.categories[ci].diagnoses.length + 1}`, symptomIds: [], applicableMedicineIds: [], prohibitedMedicineIds: [] }); this.render(); }
  removeDiagnosis(v) { const [ci, di] = v.split(":"); this.data.categories[ci].diagnoses.splice(di, 1); this.render(); }
  addTag(v) { const [ci, di] = v.split(":"); this.data.categories[ci].diagnoses[di].symptomIds ||= []; this.data.categories[ci].diagnoses[di].symptomIds.push(""); this.render(); }
  removeTag(v) { const [ci, di, , k] = v.split(":"); this.data.categories[ci].diagnoses[di].symptomIds.splice(k, 1); this.render(); }
}

export class MedicinesEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "medicines.json", "药品知识编辑器", "编辑药品基本资料、价格、分类和诊断关系"); }
  render() { const list = this.data.medicines || (this.data.medicines = []); this.root().innerHTML = `<div class="dev-ded-toolbar">${btn("＋ 添加药品", "add-medicine")}</div><div class="dev-ded-list">${list.map((m, i) => `<article class="dev-ded-card"><div class="dev-ded-card-title"><b>${esc(m.name || "未命名药品")}</b>${btn("− 删除", "remove-medicine", i)}</div><div class="dev-ded-grid">${input("药品 ID", `m.${i}.id`, m.id)} ${input("名称", `m.${i}.name`, m.name)} ${input("分类 ID", `m.${i}.category`, m.categoryId)} ${num("价格", `m.${i}.price`, m.price, "min=0 step=1")}</div>${input("效果说明", `m.${i}.effect`, m.effect)}<div class="dev-ded-grid">${input("适用诊断 ID（逗号分隔）", `m.${i}.applicable`, (m.applicableDiagnosisIds || []).join(","))} ${input("禁用诊断 ID（逗号分隔）", `m.${i}.prohibited`, (m.prohibitedDiagnosisIds || []).join(","))}</div></article>`).join("") || "<p>暂无药品。</p>"}</div>`; }
  sync() { (this.data.medicines || []).forEach((m, i) => { m.id = this.value(`m.${i}.id`).trim(); m.name = this.value(`m.${i}.name`); m.categoryId = this.value(`m.${i}.category`); m.price = Number(this.value(`m.${i}.price`)) || 0; m.commission = Math.round(m.price * 0.1 * 100) / 100; m.effect = this.value(`m.${i}.effect`); m.applicableDiagnosisIds = this.value(`m.${i}.applicable`).split(",").map((x) => x.trim()).filter(Boolean); m.prohibitedDiagnosisIds = this.value(`m.${i}.prohibited`).split(",").map((x) => x.trim()).filter(Boolean); }); }
  addMedicine() { this.data.medicines.push({ id: `med_new_${this.data.medicines.length + 1}`, name: "新药品", effect: "", price: 0, commission: 0, applicableDiagnosisIds: [], prohibitedDiagnosisIds: [], categoryId: "" }); this.render(); }
  removeMedicine(i) { this.data.medicines.splice(Number(i), 1); this.render(); }
}

export class MedicalEventsEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "medical_events.json", "医疗事件编辑器", "编辑罚款、奖励和投诉/暴动对话列表"); }
  render() { const list = (key) => (this.data[key] || []).map((x, i) => `<div class="dev-ded-inline">${input(`第 ${i + 1} 条`, `${key}.${i}`, x)}${btn("−", "remove-dialogue", `${key}:${i}`)}</div>`).join(""); this.root().innerHTML = `<div class="dev-ded-grid">${num("投诉罚款", "complaintFine", this.data.complaintFine, "min=0")}${num("暴动罚款", "riotFine", this.data.riotFine, "min=0")}${num("诊断奖励", "diagnosisBonus", this.data.diagnosisBonus, "min=0")}</div><section class="dev-ded-card"><h3>投诉对话</h3>${list("complaintDialogues")}${btn("＋ 添加对话", "add-dialogue", "complaintDialogues")}</section><section class="dev-ded-card"><h3>暴动对话</h3>${list("riotDialogues")}${btn("＋ 添加对话", "add-dialogue", "riotDialogues")}</section>`; }
  sync() { ["complaintFine", "riotFine", "diagnosisBonus"].forEach((k) => { this.data[k] = Number(this.value(k)) || 0; }); ["complaintDialogues", "riotDialogues"].forEach((k) => this.data[k] = (this.data[k] || []).map((_, i) => this.value(`${k}.${i}`))); }
  addDialogue(k) { this.data[k].push(""); this.render(); }
  removeDialogue(v) { const [k, i] = v.split(":"); this.data[k].splice(i, 1); this.render(); }
}


export class TimeRulesEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "time_rules.json", "时间规则编辑器", "编辑阶段时长、睡眠恢复和熬夜规则"); }
  render() { this.root().innerHTML = `<section class="dev-ded-card"><h3>阶段时长</h3>${num("白天分钟", "day.workMinutes", this.data.day?.workMinutes, "min=0 step=20")}${num("夜间分钟", "night.nightMinutes", this.data.night?.nightMinutes, "min=0 step=20")}</section><section class="dev-ded-card"><h3>睡眠与 SAN</h3>${num("完整睡眠分钟", "fullSleepMinutes", this.data.fullSleepMinutes, "min=0 step=20")}${num("不足睡眠分钟", "insufficientSleepMinutes", this.data.insufficientSleepMinutes, "min=0 step=20")}${num("每睡眠小时 SAN 恢复", "sanRecoveryPerSleepHour", this.data.sanRecoveryPerSleepHour, "min=0")}${num("三日睡眠债 SAN 损失", "threeDaySleepDebtSanLoss", this.data.threeDaySleepDebtSanLoss, "min=0")}${num("每次熬夜行动 SAN 损失", "sanLossPerLateNightAction", this.data.sanLossPerLateNightAction, "min=0")}</section>`; }
  sync() { this.data.day.workMinutes = Number(this.value("day.workMinutes")); this.data.night.nightMinutes = Number(this.value("night.nightMinutes")); ["fullSleepMinutes", "insufficientSleepMinutes", "sanRecoveryPerSleepHour", "threeDaySleepDebtSanLoss", "sanLossPerLateNightAction"].forEach((k) => this.data[k] = Number(this.value(k))); }
}

export class CalendarEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "calendar.json", "日历规则编辑器", "编辑总天数、休息日和夜班日"); }
  render() { const list = (key) => (this.data[key] || []).map((d, i) => `<div class="dev-ded-inline">${num(`第 ${i + 1} 天`, `${key}.${i}`, d, "min=1 max=31")}${btn("−", "remove-day", `${key}:${i}`)}</div>`).join(""); this.root().innerHTML = `${num("可玩总天数", "totalDays", this.data.totalDays, "min=1 max=31") }<section class="dev-ded-card"><h3>休息日</h3>${list("restDays")}${btn("＋ 添加休息日", "add-day", "restDays")}</section><section class="dev-ded-card"><h3>夜班日</h3>${list("nightDutyDays")}${btn("＋ 添加夜班日", "add-day", "nightDutyDays")}</section>`; }
  sync() { this.data.totalDays = Number(this.value("totalDays")); ["restDays", "nightDutyDays"].forEach((k) => this.data[k] = (this.data[k] || []).map((_, i) => Number(this.value(`${k}.${i}`))).filter(Number.isFinite)); }
  addDay(k) { this.data[k].push(1); this.render(); }
  removeDay(v) { const [k, i] = v.split(":"); this.data[k].splice(i, 1); this.render(); }
}

export class AchievementsEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "achievements.json", "成就定义编辑器", "编辑成就标题、说明、分类和隐藏状态"); }
  render() { const list = this.data.achievements || (this.data.achievements = []); this.root().innerHTML = `<div class="dev-ded-toolbar">${btn("＋ 添加成就", "add-achievement")}</div>${list.map((a, i) => `<article class="dev-ded-card"><div class="dev-ded-card-title"><b>${esc(a.title || a.id || "未命名成就")}</b>${btn("− 删除", "remove-achievement", i)}</div><div class="dev-ded-grid">${input("成就 ID", `a.${i}.id`, a.id)} ${input("标题", `a.${i}.title`, a.title)} ${input("图标", `a.${i}.icon`, a.icon)} ${input("分类 ID", `a.${i}.category`, a.category)}</div>${input("描述", `a.${i}.description`, a.description)}${checkbox("隐藏成就", `a.${i}.hidden`, a.hidden)}</article>`).join("")}`; }
  sync() { (this.data.achievements || []).forEach((a, i) => { a.id = this.value(`a.${i}.id`); a.title = this.value(`a.${i}.title`); a.icon = this.value(`a.${i}.icon`); a.category = this.value(`a.${i}.category`); a.description = this.value(`a.${i}.description`); a.hidden = this.value(`a.${i}.hidden`); }); }
  addAchievement() { this.data.achievements.push({ id: `achievement_${this.data.achievements.length + 1}`, title: "新成就", description: "", icon: "🏆", category: "", hidden: false }); this.render(); }
  removeAchievement(i) { this.data.achievements.splice(Number(i), 1); this.render(); }
}

export class SkillsEditor extends DedicatedEditor {
  constructor(dev) { super(dev, "skills.json", "技能定义编辑器", "编辑技能 ID、显示名称和初始值（0–100）"); }
  render() {
    const list = this.data.skills || (this.data.skills = []);
    this.root().innerHTML = `<div class="dev-ded-toolbar">${btn("＋ 添加技能", "add-skill")}</div>`
      + list.map((s, i) => `<article class="dev-ded-card"><div class="dev-ded-card-title"><b>${esc(s.label || s.id || "未命名技能")}</b>${btn("− 删除", "remove-skill", i)}</div><div class="dev-ded-grid">${input("技能 ID", `s.${i}.id`, s.id)}${input("显示名称 (label)", `s.${i}.label`, s.label || "")}${num("初始值", `s.${i}.value`, s.value ?? 50, "min=0 max=100")}</div></article>`).join("");
  }
  sync() {
    (this.data.skills || []).forEach((s, i) => {
      s.id    = this.value(`s.${i}.id`);
      s.label = this.value(`s.${i}.label`);
      s.value = Number(this.value(`s.${i}.value`)) || 0;
      // Remove stale legacy fields if present
      delete s.name; delete s.category; delete s.initialValue; delete s.default;
    });
  }
  addSkill()      { this.data.skills.push({ id: `skill_${this.data.skills.length + 1}`, label: "新技能", value: 50 }); this.render(); }
  removeSkill(i)  { this.data.skills.splice(Number(i), 1); this.render(); }
}

export const DEDICATED_EDITOR_CLASSES = {
  "item-placements": ItemPlacementsEditor,
  diagnoses: DiagnosesEditor,
  medicines: MedicinesEditor,
  "medical-events": MedicalEventsEditor,
  "time-rules": TimeRulesEditor,
  calendar: CalendarEditor,
  achievements: AchievementsEditor,
  skills: SkillsEditor,
};
// DEV-TOOLS:END
