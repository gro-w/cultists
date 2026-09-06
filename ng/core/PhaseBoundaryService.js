import { GAME_CLOCK_EVENTS } from "./GameClock.js";

export const PHASE_EVENTS = Object.freeze({ changed: "phase:changed", settled: "phase:settled" });

/** Generic owner for duty/location/phase boundaries. Rules are data supplied by the game. */
export class PhaseBoundaryService {
  constructor({ gameClock, timeService, state, eventBus, rules = {} } = {}) {
    this.gameClock = gameClock;
    this.timeService = timeService;
    this.state = state;
    this.eventBus = eventBus;
    this.rules = {
      workStart: 480,
      workEnd: 960,
      wakeTime: 480,
      ...rules,
    };
    this._unsub = eventBus?.on(GAME_CLOCK_EVENTS.changed, (snapshot) => this._sync(snapshot));
  }

  _sync(snapshot) {
    const previous = { ...this.state };
    this.state.day = snapshot.day;
    const phase = snapshot.minutes >= this.rules.workStart && snapshot.minutes < this.rules.workEnd ? "day" : "night";
    this.state.phase = phase;
    if (previous.phase !== phase) this.eventBus?.emit(PHASE_EVENTS.changed, { previous, current: { ...this.state }, phaseChanged: true });
  }

  sync() { return this._sync(this.gameClock.snapshot()); }

  transitionOffDuty() {
    const before = { ...this.state };
    const { minutes } = this.gameClock.snapshot();
    if (this.state.duty === "on-duty") {
      this.state.duty = "off-duty";
      if (minutes >= this.rules.workStart && minutes < this.rules.workEnd) {
        this.timeService.consume(this.rules.workEnd - minutes, { source: "off-duty-boundary" });
      }
      this.state.location = this.rules.offDutyLocation || this.state.location;
    } else if (minutes >= this.rules.workStart && minutes < this.rules.workEnd) {
      this.state.duty = "on-duty";
      this.state.location = this.rules.workLocation || this.state.location;
    } else {
      this.sleep();
    }
    this.eventBus?.emit(PHASE_EVENTS.changed, { previous: before, current: { ...this.state }, phaseChanged: before.phase !== this.state.phase });
    return { before, after: { ...this.state } };
  }

  sleep() {
    const before = { ...this.state };
    const { day, minutes } = this.gameClock.snapshot();
    const untilWake = minutes < this.rules.wakeTime
      ? this.rules.wakeTime - minutes
      : (1440 - minutes) + this.rules.wakeTime;
    this.timeService.consume(untilWake, { source: "sleep" });
    const afterClock = this.gameClock.snapshot();
    this.state.duty = "on-duty";
    this.state.location = this.rules.workLocation || this.state.location;
    this.state.phase = afterClock.minutes >= this.rules.workStart && afterClock.minutes < this.rules.workEnd ? "day" : "night";
    this.eventBus?.emit(PHASE_EVENTS.settled, { before, after: { ...this.state }, fromDay: day, toDay: afterClock.day, midnightCrossed: afterClock.day > day });
    return { before, after: { ...this.state }, clock: afterClock };
  }

  destroy() { this._unsub?.(); }
}

export default PhaseBoundaryService;
