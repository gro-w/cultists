import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";
import { dialogueProgress } from "../core/DialogueProgress.js";
import { scheduleData } from "../core/ScheduleData.js";
import { createDialogueRunner } from "../core/DialogueRunner.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { medicalCaseManager } from "../core/MedicalCaseManager.js";
import { OUTCOME_LABELS } from "../core/DiceCheck.js";
import { workQueue } from "../core/ScheduleQueue.js";

const dialogueKeywordIds = (tree) => {
  if (typeof keywordManager.idsFromDialogueTree === "function") return keywordManager.idsFromDialogueTree(tree);
  const ids = [];
  Object.values(tree?.nodes || {}).forEach((node) => String(node?.text || "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => { if (!ids.includes(id)) ids.push(id); return _; }));
  return ids;
};


/**
 * HISApp - Hospital Information System.
 * Always accessible, but the patient list & dialogue content varies by the
 * current in-game day/phase (data-driven via `data/dayXXa.json` /
 * `data/dayXXb.json`, resolved through ScheduleData). Flow: pick a patient
 * -> read dialogue one line at a time, choosing options that branch the
 * conversation (click highlighted keywords to collect them) -> choose a
 * diagnosis -> prescribe medicines from the configured list.
 *
 * Dialogue tree walking (dice-check options, npcSanChange, dialogue:turn
 * budget accounting) is shared with SocialApp/MonitorApp via
 * `createDialogueRunner` (see DialogueRunner.js). A patient whose own SAN
 * (NpcStateManager) has dropped to "offline" can no longer be talked to.
 */
export async function launchHISApp() {
  await scheduleData.init();
  const [medicines] = await Promise.all([
    dataLoader.loadJSON("medicines.json"),
    medicalCaseManager.load(),
  ]);

  const root = document.createElement("div");
  root.className = "app-his";
  root.innerHTML = `
    <div class="his-layout">
      <div class="his-patient-list panel-inset"></div>
      <div class="his-main">
        <div class="his-medical-incidents"></div>
        <div class="his-dialogue panel-inset"></div>
        <div class="his-diagnosis panel-inset"></div>
        <div class="his-prescription panel-inset"></div>
      </div>
    </div>
  `;

  const patientListEl = root.querySelector(".his-patient-list");
  const incidentsEl = root.querySelector(".his-medical-incidents");
  const dialogueEl = root.querySelector(".his-dialogue");
  const diagnosisEl = root.querySelector(".his-diagnosis");
  const prescriptionEl = root.querySelector(".his-prescription");

  let currentRecord = null;

  function registerKeywords(entry) {
    const keywordDefs = {};
    (entry.patients || []).forEach((p) => {
      Object.assign(keywordDefs, keywordManager.definitionsWithSource(dialogueKeywordIds(p.dialogueTree), `病人-${p.name}`));
    });
    return keywordDefs;
  }


  function renderPatients(entry, keywordDefs) {
    patientListEl.innerHTML = `<h4>候诊病人（第${gameState.day}天 · ${
      dayNightSystem.isDaylight() ? "白天" : "夜晚"
    }）</h4>`;
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "his-schedule-note";
      note.textContent = entry.note;
      patientListEl.appendChild(note);
    }

    if (!entry.patients || entry.patients.length === 0) {
      const empty = document.createElement("p");
      empty.className = "his-empty";
      empty.textContent = "暂无候诊病人。";
      patientListEl.appendChild(empty);
      dialogueEl.innerHTML = "<h4>与病人的对话</h4><p class=\"dialogue-end\">（无病人）</p>";
      diagnosisEl.innerHTML = "<h4>诊断</h4>";
      prescriptionEl.innerHTML = "<h4>处方</h4>";
      return;
    }
    let groupKey = "";
    entry.patients.forEach((patient) => {
      const nextGroupKey = `${patient.receivedDay}:${patient.receivedTime}`;
      if (nextGroupKey !== groupKey) {
        groupKey = nextGroupKey;
        const group = document.createElement("h5");
        group.className = "schedule-group-heading";
        group.textContent = `第${patient.receivedDay}天 · ${patient.receivedTime === 480 ? "白班" : "夜班"} · ${String(Math.floor(patient.receivedTime / 60)).padStart(2, "0")}:${String(patient.receivedTime % 60).padStart(2, "0")}`;
        patientListEl.appendChild(group);
      }
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out his-patient-btn";
      const npcId = patient.npcId || patient.id;
      const offline = npcStateManager.isOffline(npcId);
      const distressed = !offline && npcStateManager.isDistressed(npcId);
      btn.textContent = `${patient.name}（${patient.age}岁）${offline ? " 🚫" : distressed ? " ⚠️" : ""}`;
      btn.addEventListener("click", () => renderDialogue(patient, keywordDefs));
      patientListEl.appendChild(btn);
    });

    // Resume the previously-selected patient in this entry, if any.
    const resumeId = dialogueProgress.get("his").actorId;
    const resumePatient = entry.patients.find((p) => p.id === resumeId);
    renderDialogue(resumePatient || entry.patients[0], keywordDefs);
  }

  function renderDialogue(patient, keywordDefs) {
    dialogueEl.innerHTML = `<h4>与 ${patient.name} 的对话</h4>`;
    const npcId = patient.npcId || patient.id;
    renderDiagnosis(patient);

    if (npcStateManager.isOffline(npcId)) {
      dialogueEl.innerHTML +=
        '<p class="dialogue-end">（该患者情绪崩溃，已请假离开，暂时无法继续问诊。）</p>';
      return;
    }
    if (npcStateManager.isDistressed(npcId)) {
      const warn = document.createElement("p");
      warn.className = "his-schedule-note npc-distress-warning";
      warn.textContent = "⚠️ 该患者情绪明显不稳定，言语间透着焦躲和不耐烦。";
      dialogueEl.appendChild(warn);
    }

    const linesEl = document.createElement("div");
    linesEl.className = "dialogue-lines";
    const optionsEl = document.createElement("div");
    optionsEl.className = "dialogue-options";
    dialogueEl.appendChild(linesEl);
    dialogueEl.appendChild(optionsEl);

    function appendLine(speaker, speakerLabel, text) {
      const p = document.createElement("p");
      p.className = `dialogue-line speaker-${speaker}`;
      p.innerHTML = `<strong>${speakerLabel}:</strong> ${keywordManager.renderHighlightedText(
        text,
        keywordDefs
      )}`;
      linesEl.appendChild(p);
      keywordManager.bindHighlights(p, keywordDefs);
      dialogueEl.scrollTop = dialogueEl.scrollHeight;
    }

    const runner = createDialogueRunner({
      actor: patient,
      appendLine,
      optionsEl,
      optionBtnClass: "win95-btn bevel-out dialogue-option-btn",
      appId: "his",
      onNodeShown: (nodeId) => dialogueProgress.set("his", patient.id, nodeId),
      onComplete: () => patient.queueInstanceId && workQueue.complete(patient.queueInstanceId),
    });

    const resumeNodeId =
      dialogueProgress.get("his").actorId === patient.id ? dialogueProgress.get("his").nodeId : null;
    runner.showNode(resumeNodeId || (patient.dialogueTree && patient.dialogueTree.start));

  }

  function renderDiagnosis(patient) {
    currentRecord = { patient, diagnosis: "", diagnosisSelect: null };
    const configuredDiagnosisOptions = patient.diagnosisOptionIds || patient.diagnosisOptions;
    const patientDiagnosisOptions = medicalCaseManager.patientDiagnosisOptionIds(patient);
    const allowedDiagnosisIds = Array.isArray(configuredDiagnosisOptions)
      ? new Set(patientDiagnosisOptions)
      : null;
    diagnosisEl.innerHTML = "";
    const form = document.createElement("div");
    form.className = "diagnosis-form";
    const heading = document.createElement("h4");
    heading.textContent = "诊断";
    form.appendChild(heading);

    const categoryRow = document.createElement("div");
    categoryRow.className = "diagnosis-row";
    const diagnosisLabel = document.createElement("label");
    diagnosisLabel.textContent = "分类: ";
    const categorySelect = document.createElement("select");
    categorySelect.className = "win95-select";
    categorySelect.innerHTML = '<option value="">-- 选择分类 --</option>';
    medicalCaseManager.diagnosisCategoriesList().forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.icdLetter || ""} 类 · ${category.name}${category.icdRange ? `（${category.icdRange}）` : ""}`;
      categorySelect.appendChild(option);
    });
    categoryRow.appendChild(diagnosisLabel);
    categoryRow.appendChild(categorySelect);
    form.appendChild(categoryRow);

    const diagnosisRow = document.createElement("div");
    diagnosisRow.className = "diagnosis-row";
    const diagnosisSelectLabel = document.createElement("label");
    diagnosisSelectLabel.textContent = "诊断: ";
    const diagnosisSelect = document.createElement("select");
    diagnosisSelect.className = "win95-select";
    diagnosisSelect.innerHTML = '<option value="">-- 先选择分类 --</option>';
    diagnosisSelect.disabled = true;
    categorySelect.addEventListener("change", () => {
      diagnosisSelect.innerHTML = '<option value="">-- 选择诊断 --</option>';
      diagnosisSelect.disabled = !categorySelect.value;
      medicalCaseManager.diagnosesInCategory(categorySelect.value)
        .filter((diagnosis) => !allowedDiagnosisIds || allowedDiagnosisIds.has(diagnosis.id))
        .forEach((diagnosis) => {
        const option = document.createElement("option");
        option.value = diagnosis.id;
        option.textContent = `${diagnosis.icd10} · ${medicalCaseManager.diagnosisLabel(diagnosis.id)}`;
        diagnosisSelect.appendChild(option);
        });
      currentRecord.diagnosis = "";
    });
    diagnosisSelect.addEventListener("change", () => { currentRecord.diagnosis = diagnosisSelect.value; });
    diagnosisRow.appendChild(diagnosisSelectLabel);
    diagnosisRow.appendChild(diagnosisSelect);
    currentRecord.diagnosisSelect = diagnosisSelect;
    form.appendChild(diagnosisRow);
    diagnosisEl.appendChild(form);
    renderPrescription();
  }

  function renderPrescription() {
    prescriptionEl.innerHTML = "<h4>处方</h4>";
    if (!currentRecord || medicalCaseManager.submissions.has(currentRecord.patient.id)) {
      prescriptionEl.innerHTML += "<p class=\"dialogue-end\">该病人的诊断已提交。</p>";
      return;
    }
    const select = document.createElement("select");
    select.className = "win95-select";
    select.multiple = true;
    select.size = Math.min(5, Math.max(2, (medicines.medicines || []).length));
    select.title = "按住 Ctrl 可选择多种药物，最多 5 种";
    select.innerHTML = `<option value="">-- 选择药品 --</option>`;
    (medicines.medicines || []).forEach((med) => {
      const opt = document.createElement("option");
      opt.value = med.id;
      opt.textContent = `${med.name}（${med.effect}，价格 ${med.price || 0} 元，提成 ${med.price ? med.price * 0.1 : med.commission || 0} 元）`;
      select.appendChild(opt);
    });

    const submitBtn = document.createElement("button");
    submitBtn.className = "win95-btn bevel-out";
    submitBtn.textContent = "提交诊断与处方";
    submitBtn.addEventListener("click", () => {
      if (!currentRecord.diagnosis) {
        prescriptionEl.insertAdjacentHTML("beforeend", '<p class="dialogue-end">请先选择诊断。</p>');
        return;
      }
      const medicineIds = [...select.selectedOptions].map((option) => option.value).filter(Boolean).slice(0, 5);
      const result = medicalCaseManager.submit({ patient: currentRecord.patient, diagnosis: currentRecord.diagnosis, medicineIds });
      if (!result.ok) return;
      prescriptionEl.innerHTML = `<h4>处方已提交</h4><p>诊断${result.correctDiagnosis ? `正确，奖金 +${result.bonus}` : "错误，无诊断奖金"}。</p><p>药品提成 +${result.commission} 元；当前收入：${result.income} 元。</p>`;
    });

    prescriptionEl.appendChild(select);
    prescriptionEl.appendChild(submitBtn);
  }

  async function renderCurrentEntry() {
    await scheduleData.init();
    const patients = workQueue.getAll()
      .filter((item) => item.payload?.type === "his" || item.payload?.patient || item.payload?.correctDiagnosisId)
      .map((item) => ({ ...item.payload?.patient || item.payload, id: item.instanceId, queueInstanceId: item.instanceId, receivedDay: item.receivedDay, receivedTime: item.receivedTime }));
    const entry = { patients };
    const keywordDefs = registerKeywords(entry);
    renderPatients(entry, keywordDefs);
    renderMedicalIncidents();
  }

  function renderMedicalIncidents() {
    medicalCaseManager.consumePendingIncidents().forEach((incident) => {
      const block = document.createElement("div");
      block.className = "his-medical-incident panel-inset";
      const type = incident.type === "riot" ? "医闹" : "投诉";
      block.innerHTML = `<h4>⚠️ ${type}事件</h4>`;
      [incident.text, `沟通判定：${OUTCOME_LABELS[incident.check.outcome] || incident.check.outcome}（${incident.check.roll} / ${incident.check.skillValue}）`, incident.result.message]
        .forEach((text) => { const p = document.createElement("p"); p.textContent = text; block.appendChild(p); });
      incidentsEl.prepend(block);
    });
  }

  function refreshDiagnosisLabels() {
    const select = currentRecord?.diagnosisSelect;
    if (!select) return;
    [...select.options].forEach((option) => {
      if (option.value) {
        const diagnosis = medicalCaseManager.diagnoses.get(option.value);
        option.textContent = `${diagnosis?.icd10 || ""} · ${medicalCaseManager.diagnosisLabel(option.value)}`;
      }
    });
  }

  const offDayNight = eventBus.on("daynight:changed", renderCurrentEntry);

  const offNpcState = eventBus.on("npc:offline", renderCurrentEntry);
  const offIncident = eventBus.on("medical:incident", renderMedicalIncidents);
  const offGameState = eventBus.on("gamestate:changed", refreshDiagnosisLabels);

  await renderCurrentEntry();

  return windowManager.createWindow({
    appId: "his",
    title: i18n.t("apps.his", "HIS 医疗系统"),
    icon: "🏥",
    width: 640,
    height: 460,
    content: root,
    onClose: () => {
      offDayNight();

      offNpcState();
      offIncident();
      offGameState();
    },
  });
}
