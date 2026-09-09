import RuntimeRecordStore from "../../core/RuntimeRecordStore.js";

const DIAGNOSIS_BONUS = 200;

/** Canonical NG owner for HIS diagnosis, prescription, income and incidents. */
export class MedicalCaseManager extends RuntimeRecordStore {
  constructor(options = {}) {
    super({ ...options, eventPrefix: "medical" });
    this.dataStore = options.dataStore;
    this.gameState = options.gameState || { day: 1, mental: 100 };
    this.publicVariables = options.publicVariables || null;
    this.patients = new Map();
    this.diagnoses = new Map();
    this.medicines = new Map();
    this.categories = [];
    this.submissions = new Map();
    this.pendingIncome = 0;
    this.pendingExpenses = 0;
    this.settledDays = new Set();
  }

  loadFromDataStore(dataStore = this.dataStore) {
    this.dataStore = dataStore || this.dataStore;
    if (!this.dataStore) return false;
    this.patients = new Map(this.dataStore.findRecords("patients", {}).map((value) => [value.id, value]));
    this.diagnoses = new Map(this.dataStore.findRecords("diagnoses", {}).map((value) => [value.id, value]));
    this.medicines = new Map(this.dataStore.findRecords("medicines", {}).map((value) => [value.id, value]));
    this.categories = this.dataStore.findRecords("diagnosisCategories", {}).map((category) => ({
      ...category,
      diagnoses: [...this.diagnoses.values()].filter((diagnosis) => diagnosis.categoryId === category.id),
    }));
    return true;
  }

  patient(id) { return this.patients.get(String(id)) || null; }
  diagnosis(id) { return this.diagnoses.get(String(id)) || null; }
  medicine(id) { return this.medicines.get(String(id)) || null; }
  diagnosisCategoriesList() { return this.categories.map((value) => ({ ...value, diagnoses: [...(value.diagnoses || [])] })); }
  patientDiagnosisOptionIds(patient) { return (patient?.diagnosisOptionIds || []).filter((id) => this.diagnoses.has(id)); }
  resolveDiagnosisId(value) {
    if (this.diagnoses.has(String(value))) return String(value);
    const match = [...this.diagnoses.values()].find((entry) => entry.normalName === value || entry.lowSanName === value);
    return match?.id || null;
  }
  diagnosisLabel(id, mental = this.gameState.mental) {
    const entry = this.diagnosis(id);
    if (!entry) return id || "未知诊断";
    return Number(mental) <= 30 ? (entry.lowSanName || entry.normalName) : entry.normalName;
  }
  money() { return Number(this.publicVariables?.get(2) ?? 0); }
  _commission(id) { return Number(this.medicine(id)?.commission ?? Number(this.medicine(id)?.price || 0) * 0.1); }

  submit({ patient, patientId, diagnosis, medicineIds = [] } = {}) {
    const target = patient || this.patient(patientId);
    if (!target?.id) return { ok: false, reason: "invalidPatient" };
    if (this.submissions.has(target.id)) return { ok: false, reason: "alreadySubmitted" };
    const diagnosisId = this.resolveDiagnosisId(diagnosis);
    if (!diagnosisId) return { ok: false, reason: "invalidDiagnosis" };
    const ids = [...new Set(medicineIds.filter(Boolean))].slice(0, 5);
    const unknownMedicine = ids.find((id) => !this.medicines.has(id));
    if (unknownMedicine) return { ok: false, reason: "invalidMedicine", medicineId: unknownMedicine };
    const diagnosisData = this.diagnosis(diagnosisId);
    const correctDiagnosis = diagnosisId === this.resolveDiagnosisId(target.correctDiagnosisId);
    const forbiddenIds = target.forbiddenMedicineIds?.length ? target.forbiddenMedicineIds : diagnosisData?.prohibitedMedicineIds || [];
    const applicableIds = target.applicableMedicineIds?.length ? target.applicableMedicineIds : diagnosisData?.applicableMedicineIds || [];
    const forbidden = ids.filter((id) => forbiddenIds.includes(id));
    const applicable = ids.some((id) => applicableIds.includes(id));
    const submission = {
      patientId: target.id, day: Number(this.gameState.day || 1), diagnosisId, correctDiagnosis,
      medicineIds: ids, bonus: correctDiagnosis ? DIAGNOSIS_BONUS : 0,
      commission: ids.reduce((sum, id) => sum + this._commission(id), 0),
      incidentType: forbidden.length ? "riot" : applicable ? null : "complaint", processed: false,
    };
    submission.dueDay = submission.incidentType === "riot" ? 7 : submission.day + 1;
    submission.dueTime = submission.incidentType === "riot" ? 960 : 480;
    this.submissions.set(target.id, submission);
    this.pendingIncome += submission.bonus + submission.commission;
    this.eventBus?.emit("medical:submitted", { ...submission, pendingIncome: this.pendingIncome });
    return { ok: true, ...structuredClone(submission), pendingIncome: this.pendingIncome };
  }

  processDue(day = this.gameState.day, clockMinutes = 0) {
    const now = Number(day) * 1440 + Number(clockMinutes);
    return [...this.submissions.values()].filter((entry) => !entry.processed && entry.incidentType && Number(entry.dueDay) * 1440 + entry.dueTime <= now).map((submission) => ({ submission: { ...submission }, type: submission.incidentType }));
  }
  settleDay(day) {
    const target = Number(day);
    if (this.settledDays.has(target)) return { day: target, income: 0, expenses: 0, balance: this.money() };
    this.settledDays.add(target);
    const result = { day: target, income: this.pendingIncome, expenses: this.pendingExpenses, balance: this.money() + this.pendingIncome - this.pendingExpenses };
    if (this.publicVariables && result.income - result.expenses) this.publicVariables.increment(2, result.income - result.expenses);
    this.pendingIncome = 0; this.pendingExpenses = 0;
    this.eventBus?.emit("medical:incomeChanged", { settlement: result });
    return result;
  }
  snapshot() { return { ...super.snapshot(), submissions: [...this.submissions.values()], pendingIncome: this.pendingIncome, pendingExpenses: this.pendingExpenses, settledDays: [...this.settledDays] }; }
  restore(snapshot = {}) { super.restore(snapshot); this.submissions = new Map((snapshot.submissions || []).map((entry) => [entry.patientId, { ...entry }])); this.pendingIncome = Number(snapshot.pendingIncome) || 0; this.pendingExpenses = Number(snapshot.pendingExpenses) || 0; this.settledDays = new Set(snapshot.settledDays || []); }
}
export default MedicalCaseManager;
