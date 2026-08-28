import { dataLoader } from "./DataLoader.js";

class CalendarData {
  constructor() {
    this.totalDays = 30;
    this.restDays = new Set();
    this._initPromise = null;
  }

  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("calendar.json").then((data) => {
        this.totalDays = Math.max(1, Number(data.totalDays) || 30);
        this.restDays = new Set((data.restDays || []).map((day) => Number(day)).filter((day) => day >= 1));
      });
    }
    return this._initPromise;
  }

  isRestDay(day) {
    return this.restDays.has(Number(day));
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
