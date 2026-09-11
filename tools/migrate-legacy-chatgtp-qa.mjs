#!/usr/bin/env node
/**
 * migrate-legacy-chatgtp-qa.mjs — Phase 8 ChatGTP window data migration.
 *
 * Converts the legacy `data/zh-hans/chatgtp_qa.json` (48,195-entry
 * keyword-combo -> answer lookup table used by `js/apps/ChatGTPApp.js`)
 * into ng's generic database seed-record shape (a `chatgtpQaEntry` per
 * `data/structures.framework.json`, keyed by the same sorted-keyword-set id the
 * legacy app computes at query time via `normalizeSet()`), plus a small
 * `chatgtp-settings.json` holding the handful of scalar knobs
 * (`sanCostPerQuery`/`offlineAnswer`/`revealKeywordIds`) that aren't
 * per-entry data.
 *
 * Every legacy entry's `corruptedSameAsNormal` is `true` (verified against
 * the full 48,195-entry dataset - `corruptedAnswer`, when present, is
 * always byte-identical to `answer`), so this migration does not carry a
 * separate corrupted-answer field: the ChatGTP window's own low-SAN
 * distortion (mirroring `KeywordManager`'s `contentLowSan` pattern) reuses
 * `answer` directly rather than doubling the seed file's size with a
 * currently-always-equal duplicate. If future authored content ever needs
 * a genuinely different corrupted answer, add an optional
 * `corruptedAnswer` field to the `chatgtpQaEntry` structure and this
 * script at that point — deliberately not speculatively added now.
 *
 * Because the 48,195-entry result is much larger than ng's other seed
 * domains, it is written directly to its canonical database file
 * (`data/databases/chatgtpQaEntries.json`). The database definition and
 * `game-manifest.json` own the runtime registration; no parallel seed mirror
 * is generated.
 *
 * Usage: `node tools/migrate-legacy-chatgtp-qa.mjs` writes both output
 * files directly (unlike `migrate-legacy-medical-reference.mjs`'s
 * print-to-stdout convention — the QA table is too large to eyeball before
 * merging by hand, and this script's output is a single, entirely
 * mechanical, idempotent transform of one source file with no hand-authored
 * content to accidentally clobber).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_OUT_PATH = path.resolve(__dirname, "../data/databases/chatgtpQaEntries.json");
const SETTINGS_OUT_PATH = path.resolve(__dirname, "../data/chatgtp-settings.json");

/** Sorted "+"-joined keyword-id key, same convention as legacy `ChatGTPApp.js#normalizeSet`. */
export function entryKey(keywordIds) {
  return [...keywordIds].map((id) => String(id).trim().toLowerCase()).sort().join("+");
}

export function convertChatgtpQa(legacyQaJson) {
  const entries = (legacyQaJson.entries || []).map((entry) => ({
    id: entryKey(entry.keywords || []),
    keywords: entry.keywords || [],
    answer: entry.answer || "",
  }));
  const settings = {
    sanCostPerQuery: Number(legacyQaJson.sanCostPerQuery) || 0,
    offlineAnswer: legacyQaJson.offlineAnswer || "",
    revealKeywordIds: legacyQaJson.revealKeywordIds || [],
  };
  return { entries, settings };
}

function main() {
  const legacyPath = process.argv[2];
  if (!legacyPath) throw new Error("Usage: node tools/migrate-legacy-chatgtp-qa.mjs <legacy-chatgtp_qa.json>");
  const legacyQaJson = JSON.parse(fs.readFileSync(path.resolve(legacyPath), "utf8"));
  const { entries, settings } = convertChatgtpQa(legacyQaJson);
  // Keep the canonical database's existing reviewable formatting stable.
  fs.writeFileSync(SEED_OUT_PATH, JSON.stringify({ chatgtpQaEntries: entries }, null, 2) + "\n");
  fs.writeFileSync(SETTINGS_OUT_PATH, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`Wrote ${entries.length} chatgtpQaEntries to ${path.relative(process.cwd(), SEED_OUT_PATH)}\n`);
  process.stdout.write(`Wrote settings to ${path.relative(process.cwd(), SETTINGS_OUT_PATH)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
