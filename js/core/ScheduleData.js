import { dataLoader } from "./DataLoader.js";

/**
 * ScheduleData - resolves the per-day-phase content file for HIS/Social.
 *
 * Content used to live in two flat `*_schedule.json` arrays; it now lives
 * in one merged file per day-phase slot (`data/day01a.json` = day 1
 * day-phase, `data/day01b.json` = day 1 night-phase, ... `day05b.json` =
 * day 5 night-phase), each carrying both `patients` (HIS) and `contacts`
 * (Social) for that slot. `data/days.json` only records how many days were
 * authored (`totalDays`); once `day` exceeds that, slots cycle so the game
 * never runs out of content.
 */
class ScheduleData {
  constructor() {
    this.totalDays = 1;
    this._initPromise = null;
  }

  /**
   * Load `data/days.json` (idempotent, and safe to call concurrently from
   * multiple callers - the in-flight promise is cached so overlapping
   * callers all await the same load instead of racing past a boolean
   * guard set only after the `await` resolves).
   */
  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("days.json").then((data) => {
        this.totalDays = Math.max(1, Number(data.totalDays) || 1);
      });
    }
    return this._initPromise;
  }

  /** Whether `day`/`phase` is (or is past) the final authored slot. */
  isFinalPhase(day, phase) {
    return phase === "night" && day >= this.totalDays;
  }

  /** File name for a given day/phase, cycling through authored days. */
  fileNameFor(day, phase) {
    const cappedDay = ((Math.max(1, day) - 1) % this.totalDays) + 1;
    const suffix = phase === "night" ? "b" : "a";
    return `day${String(cappedDay).padStart(2, "0")}${suffix}.json`;
  }

  /** Load (and cache, via DataLoader) the day-phase file for day/phase. */
  async load(day, phase) {
    return dataLoader.loadJSON(this.fileNameFor(day, phase));
  }

  /** Load every authored day-phase file (used by SaveManager to build canonical index tables). */
  async loadAllEntries() {
    const entries = [];
    for (let day = 1; day <= this.totalDays; day += 1) {
      for (const phase of ["day", "night"]) {
        // eslint-disable-next-line no-await-in-loop
        const data = await dataLoader.loadJSON(this.fileNameFor(day, phase));
        entries.push({ day, phase, data });
      }
    }
    return entries;
  }
}

export const scheduleData = new ScheduleData();
export default ScheduleData;
