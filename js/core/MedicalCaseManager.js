import { dataLoader } from "./DataLoader.js";
import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { endingManager } from "./EndingManager.js";


/** Owns submitted HIS cases, income, and delayed medical incidents. */
class MedicalCaseManager {
  constructor() {
    this.config = null;
    this.medicines = new Map();
    this.diagnoses = new Map();
    this.diagnosisCategories = [];
    this.lowSanThreshold = 30;
    this.submissions = new Map();
    this.income = 0;
    this.pendingIncome = 0;
    this.pendingExpenses = 0;
    this.settledDays = new Set();
    this.pendingIncidents = [];
    this._restoring = false;
    this._loadPromise = null;
  }

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        dataLoader.loadJSON("medical_events.json"),
        dataLoader.loadJSON("medicines.json"),
        dataLoader.loadJSON("diagnoses.json"),
      ]).then(([data, medicineData, diagnosisData]) => {
        this.config = data;
        this.medicines = new Map((medicineData.medicines || []).map((medicine) => [medicine.id, medicine]));
        this.lowSanThreshold = Number.isFinite(Number(diagnosisData.lowSanThreshold))
          ? Number(diagnosisData.lowSanThreshold)
          : 30;
        this.diagnosisCategories = diagnosisData.categories || [{ id: "general", name: "全部诊断", diagnoses: diagnosisData.diagnoses || [] }];
        this.diagnoses = new Map(this.diagnosisCategories.flatMap((category) =>
          (category.diagnoses || []).map((diagnosis) => [diagnosis.id, { ...diagnosis, categoryId: category.id }])));
      });
    }
    return this._loadPromise;
  }

  submit({ patient, diagnosis, medicineIds }) {
    const key = patient.id;
    if (this.submissions.has(key)) return { ok: false, reason: "alreadySubmitted" };
    const ids = [...new Set((medicineIds || []).filter(Boolean))].slice(0, 5);
    const diagnosisId = this.resolveDiagnosisId(diagnosis);
    const correctDiagnosisId = this.patientCorrectDiagnosisId(patient);
    if (!diagnosisId || !this.diagnoses.has(diagnosisId)) {
      return { ok: false, reason: "invalidDiagnosis" };
    }
    const unknownMedicine = ids.find((id) => !this.medicines.has(id));
    if (unknownMedicine) return { ok: false, reason: "invalidMedicine" };
    const correctDiagnosis = diagnosisId === correctDiagnosisId;
    const diagnosisData = this.diagnoses.get(diagnosisId);
    const forbiddenMedicineIds = patient.forbiddenMedicineIds?.length
      ? patient.forbiddenMedicineIds
      : diagnosisData?.prohibitedMedicineIds || [];
    const applicableMedicineIds = patient.applicableMedicineIds?.length
      ? patient.applicableMedicineIds
      : diagnosisData?.applicableMedicineIds || [];
    const forbidden = ids.filter((id) => forbiddenMedicineIds.includes(id));
    const applicable = ids.some((id) => applicableMedicineIds.includes(id));
    const bonus = correctDiagnosis ? Number(this.config?.diagnosisBonus || 0) : 0;
    const commission = ids.reduce((sum, id) => sum + Number(this._medicineCommission(id) || 0), 0);
    const incidentType = forbidden.length ? "riot" : applicable ? null : "complaint";
    const submission = {
      patientId: key,
      day: gameState.day,
      dueDay: gameState.day + 3,
      diagnosisId,
      correctDiagnosis,
      medicineIds: ids,
      bonus,
      commission,
      incidentType,
      processed: false,
    };
    this.submissions.set(key, submission);
    this.pendingIncome += bonus + commission;
    eventBus.emit("medical:submitted", { ...submission, income: this.income, pendingIncome: this.pendingIncome });
    return { ok: true, ...submission, income: this.income, pendingIncome: this.pendingIncome };
  }

  resolveDiagnosisId(value) {
    if (this.diagnoses.has(value)) return value;
    const diagnosis = [...this.diagnoses.values()].find((entry) => entry.normalName === value || entry.lowSanName === value);
    return diagnosis ? diagnosis.id : null;
  }

  patientCorrectDiagnosisId(patient) {
    return this.resolveDiagnosisId(patient.correctDiagnosisId || patient.correctDiagnosis);
  }

  patientDiagnosisOptionIds(patient) {
    const values = patient.diagnosisOptionIds || patient.diagnosisOptions || [];
    return values.map((value) => this.resolveDiagnosisId(value)).filter(Boolean);
  }

  diagnosisCategoriesList() {
    return this.diagnosisCategories;
  }

  diagnosesInCategory(categoryId) {
    return this.diagnosisCategories.find((category) => category.id === categoryId)?.diagnoses || [];
  }

  diagnosisLabel(id, mental = gameState.sanity) {
    const diagnosis = this.diagnoses.get(id);
    if (!diagnosis) return id || "未知诊断";
    return Number(mental) <= this.lowSanThreshold
      ? (diagnosis.lowSanName || diagnosis.normalName)
      : diagnosis.normalName;
  }

  _medicineCommission(id) {
    const medicine = this.medicines.get(id);
    return medicine ? Number(medicine.price || 0) * 0.1 : 0;
  }

  processDue(day = gameState.day) {
    if (this._restoring) return [];
    const requests = [];
    for (const submission of this.submissions.values()) {
      if (submission.processed || submission.dueDay > day || !submission.incidentType) continue;
      const dialogueKey = submission.incidentType === "riot" ? "riotDialogues" : "complaintDialogues";
      requests.push({
        submission: { ...submission },
        type: submission.incidentType,
        dialogues: [...(this.config?.[dialogueKey] || [])],
      });
    }
    return requests;
  }

  resolveScheduledIncident({ submission, type, text, check }) {
    if (!submission || !type || !text || !check) throw new Error("Invalid scheduled medical incident");
    const displayCheck = { ...check, skillValue: check.skillValue ?? check.target };
    let result;
    if (type === "complaint") {
      if (check.outcome === "success" || check.outcome === "largeSuccess") {
        result = { kind: "none", fine: 0, message: "沟通成功，投诉暂时平息。" };
      } else {
        const multiplier = check.outcome === "largeFailure" || Number(check.roll) >= 96 ? 2 : 1;
        const fine = Number(this.config?.complaintFine || 0) * multiplier;
        this.pendingExpenses += fine;
        result = { kind: "fine", fine, message: `投诉处理失败，罚款 ${fine} 元。` };
      }
    } else if (check.outcome === "failure" || check.outcome === "largeFailure") {
      result = { kind: "ending", fine: 0, message: "医闹失控，你被家属当场杀死。" };
      eventBus.emit("medical:incident", { type, text, check: displayCheck, result, submission });
      endingManager.trigger("mob_violence_death");
      return result;
    } else {
      const multiplier = check.outcome === "success" ? 2 : 1;
      const fine = Number(this.config?.riotFine || 0) * multiplier;
      this.pendingExpenses += fine;
      result = { kind: "fine", fine, message: `医闹暂时平息，罚款 ${fine} 元。` };
    }
    const incident = { type, text, check: displayCheck, result, submission };
    this.pendingIncidents.push(incident);
    eventBus.emit("medical:incident", incident);
    eventBus.emit("medical:incomeChanged", { income: this.income });
    return incident;
  }

  consumePendingIncidents() {
    const incidents = this.pendingIncidents.slice();
    this.pendingIncidents.length = 0;
    return incidents;
  }

  settleDay(day) {
    const targetDay = Number(day);
    if (!Number.isInteger(targetDay) || targetDay < 1 || this.settledDays.has(targetDay)) {
      return { day: targetDay, income: 0, expenses: 0, balance: this.income };
    }
    this.settledDays.add(targetDay);
    const income = this.pendingIncome;
    const expenses = this.pendingExpenses;
    this.pendingIncome = 0;
    this.pendingExpenses = 0;
    this.income += income - expenses;
    const result = { day: targetDay, income, expenses, balance: this.income };
    eventBus.emit("medical:incomeChanged", { income: this.income, settlement: result });
    return result;
  }

  snapshot() {
    return {
      income: this.income,
      pendingIncome: this.pendingIncome,
      pendingExpenses: this.pendingExpenses,
      settledDays: [...this.settledDays],
      submissions: [...this.submissions.values()],
      pendingIncidents: this.pendingIncidents,
    };
  }

  restore(snapshot = {}) {
    this.income = Number(snapshot.income) || 0;
    this.pendingIncome = Number(snapshot.pendingIncome) || 0;
    this.pendingExpenses = Number(snapshot.pendingExpenses) || 0;
    this.settledDays = new Set(Array.isArray(snapshot.settledDays) ? snapshot.settledDays.filter((day) => Number.isInteger(day)) : []);
    this.submissions = new Map((snapshot.submissions || []).filter((s) => s && s.patientId).map((s) => [s.patientId, { ...s }]));
    this.pendingIncidents = Array.isArray(snapshot.pendingIncidents) ? snapshot.pendingIncidents : [];
    eventBus.emit("medical:incomeChanged", { income: this.income });
  }

  beginRestore() {
    this._restoring = true;
  }

  endRestore() {
    this._restoring = false;
  }
}

export const medicalCaseManager = new MedicalCaseManager();
export default MedicalCaseManager;
