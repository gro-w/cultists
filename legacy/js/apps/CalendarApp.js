import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { calendarData } from "../core/CalendarData.js";
import { gameState } from "../core/GameState.js";
import { eventBus } from "../core/EventBus.js";

/** Render the data-driven rest-day and night-duty calendar. */
export async function launchCalendarApp() {
  await calendarData.init();

  const root = document.createElement("div");
  root.className = "app-calendar";
  root.innerHTML = `
    <div class="calendar-summary panel-inset"></div>
    <div class="calendar-legend" aria-label="日历图例">
      <span><i class="calendar-legend-swatch calendar-rest-swatch"></i>休息日</span>
      <span><i class="calendar-legend-swatch calendar-night-swatch"></i>夜班值班日</span>
      <span><i class="calendar-legend-swatch calendar-current-swatch"></i>今天</span>
      <span><i class="calendar-legend-swatch calendar-locked-swatch"></i>未解锁</span>
    </div>
    <div class="calendar-locked-notice">第 8–31 天未解锁，敬请期待完整版发布</div>
    <div class="calendar-grid" role="list" aria-label="第 1 至 ${calendarData.totalDays} 天"></div>
  `;

  const summaryEl = root.querySelector(".calendar-summary");
  const gridEl = root.querySelector(".calendar-grid");
  const restDays = calendarData.restDays;

  function renderCalendar() {
    summaryEl.innerHTML = `
      <strong>实习日历</strong>
      <span>共 ${calendarData.totalDays} 天 · 休息日 ${restDays.size} 天 · 夜班值班日 ${calendarData.nightDutyDays.size} 天</span>
    `;
    gridEl.innerHTML = "";
    for (let day = 1; day <= calendarData.totalDays; day += 1) {
      const isRestDay = calendarData.isRestDay(day);
      const isNightDutyDay = calendarData.isNightDutyDay(day);
      const isCurrentDay = Number(gameState.day) === day;
      const cell = document.createElement("div");
      cell.className = [
        "calendar-day",
        isRestDay ? "calendar-rest-day" : "calendar-duty-day",
        isNightDutyDay ? "calendar-night-duty" : "",
        isCurrentDay ? "calendar-current-day" : "",
      ].filter(Boolean).join(" ");
      cell.setAttribute("role", "listitem");
      cell.setAttribute("aria-label", `第 ${day} 天：${isRestDay ? "休息日" : isNightDutyDay ? "夜班值班日" : "工作日"}`);
      cell.innerHTML = `
        <span class="calendar-day-number">${day}</span>
        <span class="calendar-day-label">${isRestDay ? "休息日" : isNightDutyDay ? "夜班值班" : "工作日"}</span>
        ${isCurrentDay ? '<span class="calendar-today-label">今天</span>' : ""}
      `;
      gridEl.appendChild(cell);
    }
    for (let day = calendarData.totalDays + 1; day <= 31; day += 1) {
      const cell = document.createElement("div");
      cell.className = "calendar-day calendar-locked-day";
      cell.setAttribute("role", "listitem");
      cell.setAttribute("aria-label", `第 ${day} 天：未解锁`);
      cell.innerHTML = `
        <span class="calendar-day-number">${day}</span>
        <span class="calendar-day-label">未解锁</span>
      `;
      gridEl.appendChild(cell);
    }
  }

  renderCalendar();
  const offDayNight = eventBus.on("daynight:changed", renderCalendar);

  return windowManager.createWindow({
    appId: "calendar",
    title: i18n.t("apps.calendar", "日历"),
    icon: "📅",
    width: 460,
    height: 500,
    content: root,
    onClose: () => offDayNight(),
  });
}
