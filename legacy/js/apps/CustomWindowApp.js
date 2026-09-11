import { dataLoader } from "../core/DataLoader.js";
import { windowManager } from "../core/WindowManager.js";
import { activityData } from "../core/ActivityData.js";
import { activityExecutionService } from "../core/ActivityExecutionService.js";
import { mainQueue } from "../core/ActivityQueue.js";
import { workQueue } from "../core/ActivityQueue.js";
import { medicalCaseManager } from "../core/MedicalCaseManager.js";
import { activityEffectExecutor } from "../core/ActivityEffectExecutor.js";
import { gameState } from "../core/GameState.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { eventBus } from "../core/EventBus.js";
import { keywordManager } from "../core/KeywordManager.js";

const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const clone = (value) => JSON.parse(JSON.stringify(value));

function createWidgetElement(widget) {
  const tag = { button: "button", input: "input", textarea: "textarea", select: "select", checkbox: "label", image: "div" }[widget.type] || "div";
  const element = document.createElement(tag);
  element.className = `custom-window-widget ${widget.type === "button" ? "custom-window-button" : ""} ${["input", "textarea", "select"].includes(widget.type) ? "custom-window-input" : ""} ${widget.type === "checkbox" ? "custom-window-check" : ""} ${widget.type === "image" ? "custom-window-image" : ""} ${widget.cssClass || ""}`.trim();
  element.style.display = widget.type === "checkbox" ? "flex" : "block";
  element.dataset.customWidget = String(widget.id);
  Object.assign(element.style, { left: `${Number(widget.x) || 0}px`, top: `${Number(widget.y) || 0}px`, width: `${Number(widget.width) || 120}px`, height: `${Number(widget.height) || 30}px` });
  if (widget.type === "button") { element.type = "button"; element.textContent = widget.text || "按钮"; }
  else if (widget.type === "input") element.placeholder = widget.placeholder || widget.text || "输入";
  else if (widget.type === "textarea") { element.placeholder = widget.placeholder || "输入"; element.value = widget.text || ""; }
  else if (widget.type === "select") element.appendChild(new Option(widget.text || "请选择", ""));
  else if (widget.type === "checkbox") { const input = document.createElement("input"); input.type = "checkbox"; element.append(input, document.createTextNode(widget.text || "复选框")); }
  else element.textContent = widget.text || (widget.type === "image" ? "图片" : "");
  return element;
}

export async function launchCustomWindowApp(appId = "his_custom") {
  const apps = await dataLoader.loadJSON("applist.json");
  const catalog = Array.isArray(apps) ? apps : apps.apps || [];
  const descriptor = catalog.find((app) => app.id === appId);
  if (!descriptor) throw new Error(`找不到自定义窗口：${appId}`);
  const fileName = descriptor.file || `app_${appId}.json`;
  const config = await dataLoader.loadJSON(fileName);
  await Promise.all([activityData.init(), medicalCaseManager.load()]);
  const root = document.createElement("div");
  root.className = "custom-window-app";
  root.style.position = "relative";
  root.innerHTML = `<div class="custom-window-canvas"></div><div class="custom-window-status" aria-live="polite"></div>`;
  const canvas = root.querySelector(".custom-window-canvas");
  const status = root.querySelector(".custom-window-status");
  canvas.style.width = `${Math.max(260, Number(config.width) || 520)}px`;
  canvas.style.height = `${Math.max(160, Number(config.height) || 360)}px`;
  canvas.style.position = "relative";
  canvas.style.display = "block";
  canvas.style.isolation = "isolate";
  canvas.style.background = config.background || "#d4d0c8";
  (Array.isArray(config.widgets) ? config.widgets : []).forEach((item) => canvas.appendChild(createWidgetElement(item)));
  if (config.layout === "his") {
    root.classList.add("app-his");
    canvas.classList.add("his-layout");
    canvas.style.border = "0";
    canvas.style.boxShadow = "none";
    canvas.style.background = "transparent";
    status.hidden = true;
    const byId = (id) => canvas.querySelector(`[data-custom-widget="${CSS.escape(id)}"]`);
    const patientList = byId("patient-list");
    const main = document.createElement("div");
    main.className = "his-main";
    ["medical-incidents", "dialogue", "diagnosis-panel", "prescription"].forEach((id) => {
      const panel = byId(id);
      if (panel) main.appendChild(panel);
    });
    canvas.appendChild(main);
    if (patientList) canvas.insertBefore(patientList, main);
    const diagnosisPanel = byId("diagnosis-panel");
    ["diagnosis-category", "diagnosis"].forEach((id) => { const control = byId(id); if (control) diagnosisPanel?.appendChild(control); });
    const prescriptionPanel = byId("prescription");
    ["medicine-1", "submit"].forEach((id) => { const control = byId(id); if (control) prescriptionPanel?.appendChild(control); });
    if (diagnosisPanel) {
      const category = byId("diagnosis-category");
      const diagnosis = byId("diagnosis");
      diagnosisPanel.replaceChildren();
      const heading = document.createElement("h4");
      heading.textContent = "诊断";
      const categoryRow = document.createElement("div");
      categoryRow.className = "diagnosis-row";
      categoryRow.append(Object.assign(document.createElement("label"), { textContent: "分类: " }), category);
      const diagnosisRow = document.createElement("div");
      diagnosisRow.className = "diagnosis-row";
      diagnosisRow.append(Object.assign(document.createElement("label"), { textContent: "诊断: " }), diagnosis);
      diagnosisPanel.append(heading, categoryRow, diagnosisRow);
    }
    if (prescriptionPanel) {
      const heading = document.createElement("h4");
      heading.textContent = "处方";
      prescriptionPanel.prepend(heading);
    }
    [patientList, main, byId("medical-incidents"), byId("dialogue"), diagnosisPanel, prescriptionPanel,
      byId("diagnosis-category"), byId("diagnosis"), byId("medicine-1"), byId("submit")].filter(Boolean).forEach((element) => {
      element.style.position = "static"; element.style.left = ""; element.style.top = ""; element.style.width = ""; element.style.height = ""; element.style.transform = `translate(${Number(config.widgets.find((item) => item.id === element.dataset.customWidget)?.x) || 0}px,${Number(config.widgets.find((item) => item.id === element.dataset.customWidget)?.y) || 0}px)`;
    });
  }
  const widgetById = new Map((config.widgets || []).map((widget) => [widget.id, widget]));
  let selectedPatient = null;
  let activePatientRunner = null;
  const widget = (id) => canvas.querySelector(`[data-custom-widget="${CSS.escape(id)}"]`);
  const patientEntries = () => workQueue.getAll()
    .filter((item) => item.payload?.type === "his" || item.payload?.patient || item.payload?.correctDiagnosisId)
    .map((item) => ({ ...(item.payload?.patient || item.payload), id: item.instanceId, queueEntry: item }));
  const renderPatients = (query = "") => {
    const list = widget("patient-list");
    if (!list) return;
    const needle = String(query || "").trim().toLowerCase();
    list.replaceChildren();
    const heading = document.createElement("div");
    heading.textContent = `候诊病人（第${gameState.day}天 · ${dayNightSystem.isDaylight() ? "白天" : "夜晚"}）`;
    list.appendChild(heading);
    workQueue.getPending().filter((item) => item.kind === "medicalIncident").forEach((incident) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "win95-btn bevel-out his-medical-incident-btn";
      button.dataset.patientId = `incident:${incident.instanceId}`;
      button.textContent = incident.incidentType === "riot" ? "⚠️ 愤怒的家属（医闹）" : "⚠️ 愤怒的患者（投诉）";
      list.appendChild(button);
    });
    patientEntries().filter((patient) => !needle || `${patient.name || ""}${patient.age || ""}`.toLowerCase().includes(needle)).forEach((patient) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "win95-btn bevel-out his-patient-btn";
      button.dataset.patientId = patient.id;
      button.textContent = `${patient.name || patient.id}（${patient.age ?? "?"}岁）`;
      if (medicalCaseManager.submissions.has(patient.id)) button.classList.add("his-patient-submitted");
      list.appendChild(button);
    });
  };
  const renderDiagnosis = () => {
    const select = widget("diagnosis");
    const categorySelect = widget("diagnosis-category");
    if (!select || !selectedPatient) return;
    if (categorySelect) {
      const currentCategory = categorySelect.value;
      categorySelect.replaceChildren(new Option("-- 选择分类 --", ""));
      medicalCaseManager.diagnosisCategoriesList().forEach((category) => categorySelect.appendChild(new Option(`${category.icdLetter || ""} 类 · ${category.name}`, category.id)));
      categorySelect.value = currentCategory;
    }
    select.replaceChildren(new Option("-- 选择诊断 --", ""));
    const allowed = new Set(medicalCaseManager.patientDiagnosisOptionIds(selectedPatient));
    medicalCaseManager.diagnosisCategoriesList().filter((category) => !categorySelect?.value || category.id === categorySelect.value).forEach((category) => (category.diagnoses || []).forEach((diagnosis) => {
      if (allowed.size && !allowed.has(diagnosis.id)) return;
      select.appendChild(new Option(`${diagnosis.icd10 || ""} · ${medicalCaseManager.diagnosisLabel(diagnosis.id)}`, diagnosis.id));
    }));
  };
  let prescriptionCount = 1;
  const renderPrescription = () => {
    const panel = widget("prescription");
    if (!panel) return;
    const heading = panel.querySelector("h4") || Object.assign(document.createElement("h4"), { textContent: "处方" });
    const rows = panel.querySelector(".his-prescription-rows") || Object.assign(document.createElement("div"), { className: "his-prescription-rows" });
    const submit = widget("submit");
    const selectedMedicines = [...panel.querySelectorAll(".his-medicine-select")].map((item) => item.value);
    panel.replaceChildren(heading, rows);
    rows.replaceChildren();
    for (let index = 0; index < prescriptionCount; index += 1) {
      const row = document.createElement("div");
      row.className = "his-prescription-row";
      const select = document.createElement("select");
      select.className = "win95-select his-medicine-select";
      select.dataset.customWidget = `medicine-${index + 1}`;
      select.appendChild(new Option("-- 不开药 --", ""));
      medicalCaseManager.medicines.forEach((medicine) => select.appendChild(new Option(`${medicine.name}（${medicine.price || 0} 元）`, medicine.id)));
      select.value = selectedMedicines[index] || "";
      const add = document.createElement("button");
      add.type = "button"; add.className = "win95-btn bevel-out his-prescription-copy"; add.textContent = "+"; add.title = "增加药品行";
      add.disabled = prescriptionCount >= 5;
      add.addEventListener("click", () => { if (prescriptionCount < 5) { prescriptionCount += 1; renderPrescription(); } });
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "win95-btn bevel-out his-prescription-delete"; remove.textContent = "−"; remove.title = "删除药品行";
      remove.disabled = prescriptionCount <= 1;
      remove.addEventListener("click", () => { if (prescriptionCount > 1) { prescriptionCount -= 1; renderPrescription(); } });
      row.append(select, add, remove);
      rows.appendChild(row);
    }
    if (submit) panel.appendChild(submit);
  };
  const uiEffects = {
    ...activityEffectExecutor,
    uiSetText: (widgetId, value) => {
      if (widgetId === "status") { status.textContent = value; return; }
      const element = canvas.querySelector(`[data-custom-widget="${CSS.escape(widgetId)}"]`);
      if (!element) return;
      if (element.matches("input,textarea,select")) element.value = value;
      else element.textContent = value;
    },
    uiSetValue: (widgetId, value) => {
      const element = canvas.querySelector(`[data-custom-widget="${CSS.escape(widgetId)}"]`);
      if (!element) return;
      if (element.matches("input[type=checkbox]")) element.checked = Boolean(value);
      else element.value = value == null ? "" : String(value);
    },
    uiSetOptions: (widgetId, options) => {
      const element = canvas.querySelector(`[data-custom-widget="${CSS.escape(widgetId)}"]`);
      if (!element || element.tagName !== "SELECT") return;
      const list = Array.isArray(options) ? options : [];
      element.replaceChildren(...list.map((option) => {
        const item = document.createElement("option");
        item.value = typeof option === "object" ? String(option.value ?? option.id ?? "") : String(option);
        item.textContent = typeof option === "object" ? String(option.label ?? option.text ?? item.value) : String(option);
        return item;
      }));
    },
    hisRefresh: (query = "") => renderPatients(query),
    hisSelectPatient: (patientId) => {
      const entry = patientEntries().find((patient) => patient.id === patientId);
      const incident = workQueue.getInstance(String(patientId).replace(/^incident:/, ""));
      if (!entry && incident?.kind === "medicalIncident") {
        const dialogue = widget("dialogue");
        if (!dialogue) return;
        const lines = document.createElement("div");
        const controls = document.createElement("div");
        dialogue.replaceChildren(lines, controls);
        activityExecutionService.run({
          queue: workQueue, definition: incident, instance: incident, optionsEl: controls, appId: "his-custom",
          appendLine: (_speaker, label, text) => { lines.replaceChildren(Object.assign(document.createElement("p"), { textContent: `${label}: ${text}` })); },
          onComplete: (resolved) => { workQueue.complete(resolved.instanceId); renderPatients(); },
        });
        return;
      }
      if (!entry) return;
      selectedPatient = entry;
      eventBus.emit("his:patient_selected", { patientId });
      eventBus.emit("his:dialogue_seen", { patientId });
      renderDiagnosis();
      renderPrescription();
      const dialogue = widget("dialogue");
      if (activePatientRunner) activityExecutionService.cancel(activePatientRunner.instance?.instanceId);
      if (!dialogue || !entry.queueEntry || entry.queueEntry.status === "resolved") return;
      const lines = document.createElement("div");
      const controls = document.createElement("div");
      dialogue.replaceChildren(lines, controls);
      activePatientRunner = activityExecutionService.run({
        queue: workQueue,
        definition: entry,
        instance: entry.queueEntry,
        optionsEl: controls,
        appId: "his-custom",
        appendLine: (_speaker, label, text) => {
          const paragraph = document.createElement("p");
          const ids = keywordManager.idsFromDialogueTree?.(entry.dialogueTree) || [];
          const definitions = keywordManager.definitionsWithSource(ids, `病人-${entry.name || ""}`);
          paragraph.innerHTML = `<strong>${esc(label)}:</strong> ${keywordManager.renderHighlightedText(text, definitions)}`;
          lines.replaceChildren(paragraph);
          keywordManager.bindHighlights(paragraph, definitions);
          if (paragraph.querySelector(".keyword-highlight")) eventBus.emit("his:keyword_available", { patientId });
        },
        onComplete: () => { activePatientRunner = null; renderPatients(); },
      });
    },
    hisRenderDiagnosis: renderDiagnosis,
    hisRenderPrescription: renderPrescription,
    hisSubmit: (diagnosisId, medicineIds) => {
      if (!selectedPatient) throw new Error("请先选择病人");
      const result = activityEffectExecutor.submitMedical(selectedPatient, diagnosisId, Array.isArray(medicineIds) ? medicineIds : []);
      const submit = widget("submit");
      if (submit) submit.disabled = true;
      renderPatients();
      status.textContent = `诊断${result.correctDiagnosis ? `正确，奖金 +${result.bonus}` : "错误，无诊断奖金"}；药品提成 +${result.commission} 元；当前收入：${result.income} 元`;
      return result;
    },
  };
  const runBlueprint = (target, eventName, inputValues = {}) => {
    const blueprintId = target?.[eventName];
    const blueprint = blueprintId && config.blueprints?.[blueprintId];
    if (!blueprint) return null;
    const result = activityData.createTemporaryInstance(clone(blueprint), "main", {});
    if (!result.ok) return null;
    const instance = result.instance;
    return activityExecutionService.run({
      queue: mainQueue,
      definition: { id: blueprintId, name: `${config.title} · ${target.id || "窗口"}`, blueprint: clone(blueprint), kind: "customWindowEvent", inputValues },
      instance,
      appendLine: (_speaker, _label, text) => { status.textContent = text; },
      appId: appId,
      effects: uiEffects,
      onComplete: () => { if (!status.textContent) status.textContent = `${eventName} 已完成`; },
    });
  };
  const openBlueprint = (widget, eventName, inputValues = {}) => runBlueprint(widget, eventName, inputValues);
  const eventValue = (event, element) => ({
    value: event.target.value ?? event.target.checked ?? element.value ?? element.checked,
    patientId: event.target.closest("[data-patient-id]")?.dataset.patientId || element.dataset.patientId,
    diagnosisId: widget("diagnosis")?.value || "",
    medicineIds: [...canvas.querySelectorAll(".his-medicine-select")].map((item) => item.value).filter(Boolean).slice(0, 5),
  });
  canvas.addEventListener("click", (event) => { const element = event.target.closest("[data-custom-widget]"); const target = element && widgetById.get(element.dataset.customWidget); if (target) openBlueprint(target, target.type === "list" ? "onSelect" : "onClick", eventValue(event, element)); });
  canvas.addEventListener("change", (event) => { const element = event.target.closest("[data-custom-widget]"); const target = element && widgetById.get(element.dataset.customWidget); if (target) openBlueprint(target, "onChange", eventValue(event, element)); });
  let destroyed = false;
  const offRefresh = eventBus.on("daynight:changed", () => runBlueprint(config, "onRefresh"));
  const offActivity = eventBus.on("activity:appended", ({ queueId }) => { if (queueId === "work") renderPatients(); });
  const offMedical = eventBus.on("medical:incident", () => renderPatients());
  const win = windowManager.createWindow({ appId, title: config.title || descriptor.title || appId, icon: config.icon || descriptor.icon || "🗔", width: Number(config.width) || 520, height: Number(config.height) || 360, content: root, onClose: () => {
    if (destroyed) return;
    destroyed = true;
    offRefresh();
    offActivity();
    offMedical();
    if (activePatientRunner) activityExecutionService.cancel(activePatientRunner.instance?.instanceId);
    (config.widgets || []).forEach((widget) => runBlueprint(widget, "onDestroy"));
    runBlueprint(config, "onDestroy");
  } });
  (config.widgets || []).forEach((widget) => runBlueprint(widget, "onCreate"));
  runBlueprint(config, "onCreate");
  renderPatients();
  renderPrescription();
  return win;
}
