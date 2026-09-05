#!/usr/bin/env node
/**
 * migrate-legacy-medical-reference.mjs — Phase 8 HIS diagnosis/prescription
 * data migration.
 *
 * Converts the legacy `data/zh-hans/diagnoses.json` (ICD-chapter
 * `categories[].diagnoses[]`) and `data/zh-hans/medicines.json`
 * (`medicines[]` + `categories[]`) reference tables into ng's generic
 * database seed-record shape, keyed by databaseId exactly like
 * `ng/data/seed-records.json` (see `ng/core/DataStore.js#loadRecordSet`).
 *
 * Run with `node ng/tools/migrate-legacy-medical-reference.mjs` to print the
 * converted `{diagnoses, diagnosisCategories, medicines, medicineCategories}`
 * object as JSON (redirect to a file, or merge into seed-records.json by
 * hand — this script never writes files itself, matching
 * `migrate-legacy-blueprint.mjs`'s `--report`-first convention of never
 * silently overwriting authored data).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_DIR = path.resolve(__dirname, "../../data/zh-hans");

export function convertDiagnoses(legacyDiagnosesJson) {
  const categories = legacyDiagnosesJson.categories || [];
  const diagnosisCategories = categories.map((category) => ({
    id: category.id,
    icdChapter: category.icdChapter || "",
    icdLetter: category.icdLetter || "",
    icdRange: category.icdRange || "",
    name: category.name || "",
  }));
  const diagnoses = categories.flatMap((category) =>
    (category.diagnoses || []).map((diagnosis) => ({
      id: diagnosis.id,
      categoryId: category.id,
      icd10: diagnosis.icd10 || "",
      normalName: diagnosis.normalName || "",
      lowSanName: diagnosis.lowSanName || "",
      applicableMedicineIds: diagnosis.applicableMedicineIds || [],
      prohibitedMedicineIds: diagnosis.prohibitedMedicineIds || [],
      symptomIds: diagnosis.symptomIds || [],
    }))
  );
  return { diagnosisCategories, diagnoses };
}

export function convertMedicines(legacyMedicinesJson) {
  const medicines = (legacyMedicinesJson.medicines || []).map((medicine) => ({
    id: medicine.id,
    name: medicine.name || "",
    effect: medicine.effect || "",
    price: Number(medicine.price) || 0,
    commission: Number(medicine.commission) || 0,
    categoryId: medicine.categoryId || "",
    applicableDiagnosisIds: medicine.applicableDiagnosisIds || [],
    prohibitedDiagnosisIds: medicine.prohibitedDiagnosisIds || [],
  }));
  const medicineCategories = (legacyMedicinesJson.categories || []).map((category) => ({
    id: category.id,
    name: category.name || "",
    medicineIds: category.medicineIds || [],
    correspondingDiseaseCategoryIds: category.correspondingDiseaseCategoryIds || [],
  }));
  return { medicines, medicineCategories };
}

export function buildSeedRecordSet({ diagnosesJson, medicinesJson }) {
  const { diagnosisCategories, diagnoses } = convertDiagnoses(diagnosesJson);
  const { medicines, medicineCategories } = convertMedicines(medicinesJson);
  return { diagnosisCategories, diagnoses, medicineCategories, medicines };
}

function main() {
  const diagnosesJson = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, "diagnoses.json"), "utf8"));
  const medicinesJson = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, "medicines.json"), "utf8"));
  const recordSet = buildSeedRecordSet({ diagnosesJson, medicinesJson });
  process.stdout.write(JSON.stringify(recordSet, null, 2) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
