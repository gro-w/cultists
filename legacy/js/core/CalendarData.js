import { dataLoader } from "./DataLoader.js";
import { MAX_GAME_DAYS } from "./GameRules.js";

class CalendarData {
  constructor() {
    this.totalDays = MAX_GAME_DAYS;
    this.restDays = new Set();
    this.nightDutyDays = new Set();
    this._initPromise = null;
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("calendar.json").then((data) => {
        this.totalDays = Math.min(MAX_GAME_DAYS, Math.max(1, Number(data.totalDays) || MAX_GAME_DAYS));
        this.restDays = new Set((data.restDays || []).map((day) => Number(day)).filter((day) => day >= 1 && day <= this.totalDays));
        this.nightDutyDays = new Set((data.nightDutyDays || [])
          .map((day) => Number(day))
          .filter((day) => day >= 1 && day <= this.totalDays));
      });
    }
    return this._initPromise;
  }

  isRestDay(day) {
    return this.restDays.has(Number(day));
  }

  isNightDutyDay(day) {
    return this.nightDutyDays.has(Number(day));
  }

  nextWorkDay(day) {
    let candidate = Number(day) + 1;
    while (this.isRestDay(candidate)) candidate += 1;
    return candidate;
  }

  nextDay(day) {
    return Number(day) + 1;
  }
}

export const calendarData = new CalendarData();
export default CalendarData;
