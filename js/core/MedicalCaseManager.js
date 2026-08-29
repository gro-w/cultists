import { dataLoader } from "./DataLoader.js";
import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

const DIAGNOSIS_BONUS = 200;


/** Owns submitted HIS cases, income, and delayed medical incidents. */
class MedicalCaseManager {
  constructor() {
    this.medicines = new Map();
    this.diagnoses = new Map();
    this.diagnosisCategories = [];
    this.lowSanThreshold = 30;
    this.submissions = new Map();
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
        dataLoader.loadJSON("medicines.json"),
        dataLoader.loadJSON("diagnoses.json"),
      ]).then(([medicineData, diagnosisData]) => {
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
    const bonus = correctDiagnosis ? DIAGNOSIS_BONUS : 0;
    const commission = ids.reduce((sum, id) => sum + Number(this._medicineCommission(id) || 0), 0);
    const incidentType = forbidden.length ? "riot" : applicable ? null : "complaint";
    const submission = {
      patientId: key,
      day: gameState.day,
      dueDay: incidentType === "riot" ? 7 : gameState.day + 1,
      dueTime: incidentType === "riot" ? 16 * 60 : 8 * 60,
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
    eventBus.emit("medical:submitted", { ...submission, income: this.money(), pendingIncome: this.pendingIncome });
    return { ok: true, ...submission, income: this.money(), pendingIncome: this.pendingIncome };
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

  money() {
    return Number(globalVariableManager.get(2) ?? 0);
  }

  processDue(day = gameState.day, clockMinutes = gameState.clockMinutes) {
    if (this._restoring) return [];
    const currentTime = Number(day) * 1440 + Number(clockMinutes);
    const requests = [];
    for (const submission of this.submissions.values()) {
      if (submission.processed || !submission.incidentType) continue;
      const dueTime = Number.isInteger(submission.dueTime)
        ? submission.dueTime
        : (submission.incidentType === "riot" ? 16 * 60 : 8 * 60);
      const dueAt = Number(submission.dueDay) * 1440 + dueTime;
      if (!Number.isFinite(dueAt) || dueAt > currentTime) continue;
      requests.push({
        submission: { ...submission },
        type: submission.incidentType,
      });
    }
    return requests;
  }


  consumePendingIncidents() {
    const incidents = this.pendingIncidents.slice();
    this.pendingIncidents.length = 0;
    return incidents;
  }

  settleDay(day) {
    const targetDay = Number(day);
    if (!Number.isInteger(targetDay) || targetDay < 1 || this.settledDays.has(targetDay)) {
      return { day: targetDay, income: 0, expenses: 0, balance: this.money() };
    }
    this.settledDays.add(targetDay);
    const income = this.pendingIncome;
    const expenses = this.pendingExpenses;
    this.pendingIncome = 0;
    this.pendingExpenses = 0;
    const moneyDelta = income - expenses;
    if (moneyDelta) globalVariableManager.modify(2, moneyDelta);
    const result = { day: targetDay, income, expenses, balance: this.money() };
    eventBus.emit("medical:incomeChanged", { income: this.money(), settlement: result });
    return result;
  }

  snapshot() {
    return {
      pendingIncome: this.pendingIncome,
      pendingExpenses: this.pendingExpenses,
      settledDays: [...this.settledDays],
      submissions: [...this.submissions.values()],
      pendingIncidents: this.pendingIncidents,
    };
  }

  restore(snapshot = {}) {
    this.pendingIncome = Number(snapshot.pendingIncome) || 0;
    this.pendingExpenses = Number(snapshot.pendingExpenses) || 0;
    this.settledDays = new Set(Array.isArray(snapshot.settledDays) ? snapshot.settledDays.filter((day) => Number.isInteger(day)) : []);
    this.submissions = new Map((snapshot.submissions || []).filter((s) => s && s.patientId).map((s) => {
      const incidentType = s.incidentType;
      return [s.patientId, {
        ...s,
        dueDay: incidentType === "riot" ? 7 : Number(s.day) + 1,
        dueTime: incidentType === "riot" ? 16 * 60 : 8 * 60,
      }];
    }));
    this.pendingIncidents = Array.isArray(snapshot.pendingIncidents) ? snapshot.pendingIncidents : [];
    eventBus.emit("medical:incomeChanged", { income: this.money() });
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
