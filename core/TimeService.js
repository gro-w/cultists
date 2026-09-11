import { GAME_CLOCK_EVENTS } from "./GameClock.js";

export const TIME_EVENTS = Object.freeze({ consumed: "time:consumed", restored: "time:restored" });

/** Generic owner for ordinary in-game time consumption. Domain phase settlement remains external. */
export class TimeService {
  constructor(gameClock, eventBus = null) {
    if (!gameClock) throw new Error("TimeService requires a gameClock");
    this.gameClock = gameClock;
    this.eventBus = eventBus;
  }

  consume(minutes, metadata = {}) {
    const amount = Number(minutes);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      throw new Error("TimeService.consume requires a non-negative integer minute count");
    }
    const before = this.gameClock.snapshot();
    const after = this.gameClock.advance(amount);
    const result = { amount, before, after, metadata: { ...metadata } };
    if (amount > 0) this.eventBus?.emit(TIME_EVENTS.consumed, result);
    return result;
  }

  restore(snapshot) {
    this.gameClock.restore(snapshot);
    const result = this.gameClock.snapshot();
    this.eventBus?.emit(TIME_EVENTS.restored, result);
    return result;
  }

  snapshot() {
    return this.gameClock.snapshot();
  }

  onChange(handler) {
    return this.eventBus?.on(GAME_CLOCK_EVENTS.changed, handler) || (() => {});
  }
}

export default TimeService;
