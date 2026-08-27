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
import { actionBudget } from "../core/ActionBudget.js";

/**
 * HISApp - Hospital Information System.
 * Always accessible, but the patient list & dialogue content varies by the
 * current in-game day/phase (data-driven via `data/dayXXa.json` /
 * `data/dayXXb.json`, resolved through ScheduleData). Flow: pick a patient
 * -> read dialogue one line at a time, choosing options that branch the
 * conversation (click highlighted keywords to collect them) -> fill the
 * medical record template using collected keywords -> prescribe a medicine
 * from the configured list.
 *
 * Dialogue tree walking (dice-check options, npcSanChange, dialogue:turn
 * budget accounting) is shared with SocialApp/MonitorApp via
 * `createDialogueRunner` (see DialogueRunner.js). A patient whose own SAN
 * (NpcStateManager) has dropped to "offline" can no longer be talked to.
 */
export async function launchHISApp() {
  await scheduleData.init();
  const [records, medicines] = await Promise.all([
    dataLoader.loadJSON("medical_records.json"),
    dataLoader.loadJSON("medicines.json"),
  ]);

  const root = document.createElement("div");
  root.className = "app-his";
  root.innerHTML = `
    <div class="his-layout">
      <div class="his-patient-list panel-inset"></div>
      <div class="his-main">
        <div class="his-dialogue panel-inset"></div>
        <div class="his-record panel-inset"></div>
        <div class="his-prescription panel-inset"></div>
      </div>
    </div>
  `;

  const patientListEl = root.querySelector(".his-patient-list");
  const dialogueEl = root.querySelector(".his-dialogue");
  const recordEl = root.querySelector(".his-record");
  const prescriptionEl = root.querySelector(".his-prescription");

  let currentRecord = null;

  function registerKeywords(entry) {
    const keywordDefs = {};
    (entry.patients || []).forEach((p) => {
      Object.assign(keywordDefs, keywordManager.definitionsWithSource(p.keywordIds, `病人-${p.name}`));
    });
    return keywordDefs;
  }

  function budgetNote() {
    const remaining = actionBudget.remaining("dialogue");
    if (!Number.isFinite(remaining)) return "";
    return remaining > 0
      ? `本阶段剩余问诊次数：${remaining}`
      : `本阶段问诊次数已用尽（继续问诊将记为加班/熬夜）`;
  }

  function renderPatients(entry, keywordDefs) {
    patientListEl.innerHTML = `<h4>候诊病人（第${gameState.day}天 · ${
      gameState.phase === "day" ? "白天" : "夜晚"
    }）</h4>`;
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "his-schedule-note";
      note.textContent = entry.note;
      patientListEl.appendChild(note);
    }
    const budgetHint = document.createElement("p");
    budgetHint.className = "his-schedule-note action-budget-hint";
    budgetHint.textContent = budgetNote();
    patientListEl.appendChild(budgetHint);

    if (!entry.patients || entry.patients.length === 0) {
      const empty = document.createElement("p");
      empty.className = "his-empty";
      empty.textContent = "暂无候诊病人。";
      patientListEl.appendChild(empty);
      dialogueEl.innerHTML = "<h4>与病人的对话</h4><p class=\"dialogue-end\">（无病人）</p>";
      recordEl.innerHTML = "<h4>病历</h4>";
      prescriptionEl.innerHTML = "<h4>处方</h4>";
      return;
    }
    entry.patients.forEach((patient) => {
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out his-patient-btn";
      const offline = npcStateManager.isOffline(patient.id);
      const distressed = !offline && npcStateManager.isDistressed(patient.id);
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

    if (npcStateManager.isOffline(patient.id)) {
      dialogueEl.innerHTML +=
        '<p class="dialogue-end">（该患者情绪崩溃，已请假离开，暂时无法继续问诊。）</p>';
      renderRecord(patient, records.templates.find((t) => t.id === patient.recordTemplateId));
      return;
    }
    if (npcStateManager.isDistressed(patient.id)) {
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
    });

    const resumeNodeId =
      dialogueProgress.get("his").actorId === patient.id ? dialogueProgress.get("his").nodeId : null;
    runner.showNode(resumeNodeId || (patient.dialogueTree && patient.dialogueTree.start));

    const recordTemplate = records.templates.find((t) => t.id === patient.recordTemplateId);
    renderRecord(patient, recordTemplate);
  }

  function renderRecord(patient, template) {
    currentRecord = { patient, template, slots: {} };
    recordEl.innerHTML = `<h4>病历: ${template ? template.title : "无模板"}</h4>`;
    if (!template) return;

    const form = document.createElement("div");
    form.className = "record-form";
    template.slots.forEach((slot) => {
      const row = document.createElement("div");
      row.className = "record-row";
      const label = document.createElement("label");
      label.textContent = `${slot.label}: `;
      const select = document.createElement("select");
      select.className = "win95-select";
      select.innerHTML = `<option value="">-- 从关键词笔记本选择 --</option>`;
      keywordManager
        .allByCategory(slot.category)
        .forEach((kw) => {
          const opt = document.createElement("option");
          opt.value = kw.id;
          opt.textContent = kw.label;
          select.appendChild(opt);
        });
      select.addEventListener("change", () => {
        currentRecord.slots[slot.id] = select.value;
      });
      row.appendChild(label);
      row.appendChild(select);
      form.appendChild(row);
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "win95-btn bevel-out";
    refreshBtn.textContent = "刷新可选关键词";
    refreshBtn.addEventListener("click", () => renderRecord(patient, template));
    form.appendChild(refreshBtn);

    recordEl.appendChild(form);
    renderPrescription();
  }

  function renderPrescription() {
    prescriptionEl.innerHTML = "<h4>处方</h4>";
    const select = document.createElement("select");
    select.className = "win95-select";
    select.innerHTML = `<option value="">-- 选择药品 --</option>`;
    (medicines.medicines || []).forEach((med) => {
      const opt = document.createElement("option");
      opt.value = med.id;
      opt.textContent = `${med.name}（${med.effect}）`;
      select.appendChild(opt);
    });

    const submitBtn = document.createElement("button");
    submitBtn.className = "win95-btn bevel-out";
    submitBtn.textContent = "提交病历与处方";
    submitBtn.addEventListener("click", () => {
      const medId = select.value;
      const med = (medicines.medicines || []).find((m) => m.id === medId);
      alert(
        `病历已提交：\n${JSON.stringify(currentRecord?.slots || {}, null, 2)}\n\n处方: ${
          med ? med.name : "（未选择）"
        }`
      );
    });

    prescriptionEl.appendChild(select);
    prescriptionEl.appendChild(submitBtn);
  }

  async function renderCurrentEntry() {
    const entry = await scheduleData.load(gameState.day, gameState.phase);
    if (!entry) {
      patientListEl.innerHTML = "<h4>候诊病人</h4><p class=\"his-empty\">（今日暂无安排）</p>";
      return;
    }
    const keywordDefs = registerKeywords(entry);
    renderPatients(entry, keywordDefs);
  }

  const offDayNight = eventBus.on("daynight:changed", renderCurrentEntry);
  const offBudget = eventBus.on("actionBudget:changed", renderCurrentEntry);
  const offNpcState = eventBus.on("npc:offline", renderCurrentEntry);

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
      offBudget();
      offNpcState();
    },
  });
}
