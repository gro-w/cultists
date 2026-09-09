import EventBus from "../core/EventBus.js";
import MedicalCaseManager from "../content/cultists/MedicalCaseManager.js";

const records = {
  patients: [{ id: "p1", correctDiagnosisId: "d1", diagnosisOptionIds: ["d1", "d2"] }],
  diagnoses: [
    { id: "d1", normalName: "正确诊断", categoryId: "c1", applicableMedicineIds: ["m1"], prohibitedMedicineIds: [] },
    { id: "d2", normalName: "错误诊断", categoryId: "c1", applicableMedicineIds: [], prohibitedMedicineIds: [] },
  ],
  diagnosisCategories: [{ id: "c1", name: "测试" }],
  medicines: [{ id: "m1", price: 100, commission: 10 }, { id: "m2", price: 50, commission: 5 }],
};
const dataStore = { findRecords: (id) => records[id] || [] };
const bus = new EventBus();
const events = [];
bus.on("medical:submitted", (payload) => events.push(payload));
const manager = new MedicalCaseManager({ eventBus: bus, dataStore, gameState: { day: 1, mental: 100 } });
manager.loadFromDataStore();
const accepted = manager.submit({ patientId: "p1", diagnosis: "d1", medicineIds: ["m1"] });
if (!accepted.ok || accepted.bonus !== 200 || accepted.commission !== 10 || accepted.incidentType !== null) throw new Error("valid HIS submission failed");
if (manager.submit({ patientId: "p1", diagnosis: "d1", medicineIds: [] }).reason !== "alreadySubmitted") throw new Error("duplicate submission was accepted");
if (events.length !== 1) throw new Error("medical submission event count mismatch");
console.log("medical-case-migration-probe: ok", JSON.stringify({ submissions: manager.submissions.size, pendingIncome: manager.pendingIncome }));
