import assert from "node:assert/strict";
import { medicalCaseManager } from "../js/core/MedicalCaseManager.js";

medicalCaseManager._restoring = false;
medicalCaseManager.submissions = new Map([
  ["complaint", { patientId: "complaint", day: 1, dueDay: 2, dueTime: 480, incidentType: "complaint", processed: false }],
  ["riot", { patientId: "riot", day: 1, dueDay: 7, dueTime: 960, incidentType: "riot", processed: false }],
]);

assert.equal(medicalCaseManager.processDue(2, 479).length, 0);
assert.equal(medicalCaseManager.processDue(2, 480).map(({ type }) => type).join(), "complaint");
medicalCaseManager.submissions.get("complaint").processed = true;
assert.equal(medicalCaseManager.processDue(7, 959).length, 0);
assert.equal(medicalCaseManager.processDue(7, 960).map(({ type }) => type).join(), "riot");
console.log("medical activity timing probe: ok");
