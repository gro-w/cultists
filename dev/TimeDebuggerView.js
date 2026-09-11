// DEV-TOOLS:START
/**
 * Live game-clock debugger. This is a development-only view: it changes the
 * generic GameClock through its public restore/advance API and never writes
 * canonical game data or save payloads directly.
 */
export class TimeDebuggerView {
  constructor({ gameClock, forceEndWork = null } = {}) {
    this.gameClock = gameClock;
    this.forceEndWork = forceEndWork;
    this.el = document.createElement("div");
    this.el.className = "ng-dev-time-debugger";
    this.el.innerHTML = `
      <div class="ng-dev-debugger-row">
        <strong>当前游戏时间</strong>
        <output data-role="current"></output>
      </div>
      <label class="ng-dev-debugger-row">天数
        <input data-role="day" type="number" min="1" step="1" value="1">
      </label>
      <label class="ng-dev-debugger-row">时间
        <input data-role="time" type="time" value="08:00" step="60">
      </label>
      <div class="ng-dev-debugger-actions">
        <button type="button" data-action="set">设置游戏时间</button>
        <button type="button" data-action="advance20">推进 20 分钟</button>
        <button type="button" data-action="advance60">推进 60 分钟</button>
        <button type="button" data-action="forceEndWork">强制下班并打开下班模式</button>
      </div>
      <p data-role="status" class="ng-dev-debugger-status"></p>
    `;
    this.currentEl = this.el.querySelector('[data-role="current"]');
    this.dayEl = this.el.querySelector('[data-role="day"]');
    this.timeEl = this.el.querySelector('[data-role="time"]');
    this.statusEl = this.el.querySelector('[data-role="status"]');
    this.el.querySelector('[data-action="set"]').addEventListener("click", () => this.setTime());
    this.el.querySelector('[data-action="advance20"]').addEventListener("click", () => this.advance(20));
    this.el.querySelector('[data-action="advance60"]').addEventListener("click", () => this.advance(60));
    this.el.querySelector('[data-action="forceEndWork"]').addEventListener("click", () => this.forceEndWork?.());
    this.render();
  }

  render() {
    const snapshot = this.gameClock?.snapshot?.() || { day: 1, minutes: 0 };
    const hours = Math.floor(snapshot.minutes / 60);
    const minutes = snapshot.minutes % 60;
    this.currentEl.textContent = `Day ${snapshot.day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    this.dayEl.value = String(snapshot.day);
    this.timeEl.value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  setTime() {
    const day = Math.max(1, Math.floor(Number(this.dayEl.value) || 1));
    const [hours, minutes] = String(this.timeEl.value || "00:00").split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      this.statusEl.textContent = "时间格式无效";
      return;
    }
    this.gameClock?.restore({ day, minutes: hours * 60 + minutes });
    this.statusEl.textContent = "游戏时间已设置";
    this.render();
  }

  advance(minutes) {
    this.gameClock?.advance(minutes);
    this.statusEl.textContent = `游戏时间已推进 ${minutes} 分钟`;
    this.render();
  }
}
// DEV-TOOLS:END
