import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { keywordManager } from "../core/KeywordManager.js";

/**
 * HISApp - Hospital Information System (day-phase only).
 * Flow: pick a patient -> read dialogue (click highlighted keywords to
 * collect them) -> fill the medical record template using collected
 * keywords -> prescribe a medicine from the configured list.
 */
export async function launchHISApp() {
  const [dialogues, records, medicines] = await Promise.all([
    dataLoader.loadJSON("dialogues_day.json"),
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

  const keywordDefs = {};
  (dialogues.patients || []).forEach((p) => {
    (p.keywords || []).forEach((k) => {
      keywordDefs[k.id] = { ...k, source: `病人-${p.name}` };
    });
  });

  let currentRecord = null;

  function renderPatients() {
    patientListEl.innerHTML = "<h4>候诊病人</h4>";
    (dialogues.patients || []).forEach((patient) => {
      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out his-patient-btn";
      btn.textContent = `${patient.name}（${patient.age}岁）`;
      btn.addEventListener("click", () => renderDialogue(patient));
      patientListEl.appendChild(btn);
    });
  }

  function renderDialogue(patient) {
    dialogueEl.innerHTML = `<h4>与 ${patient.name} 的对话</h4>`;
    const list = document.createElement("div");
    list.className = "dialogue-lines";
    (patient.dialogue || []).forEach((line) => {
      const p = document.createElement("p");
      p.className = `dialogue-line speaker-${line.speaker}`;
      const speakerLabel = line.speaker === "npc" ? patient.name : "我";
      p.innerHTML = `<strong>${speakerLabel}:</strong> ${keywordManager.renderHighlightedText(
        line.text,
        keywordDefs
      )}`;
      list.appendChild(p);
    });
    dialogueEl.appendChild(list);
    keywordManager.bindHighlights(dialogueEl, keywordDefs);

    const recordTemplate = records.templates.find(
      (t) => t.id === patient.recordTemplateId
    );
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

  renderPatients();

  return windowManager.createWindow({
    appId: "his",
    title: "HIS 医疗系统",
    icon: "🏥",
    width: 640,
    height: 460,
    content: root,
  });
}
