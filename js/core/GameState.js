import { eventBus } from "./EventBus.js";
import { MAX_GAME_DAYS } from "./GameRules.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

function phaseForClock(clockMinutes) {
  return clockMinutes >= 8 * 60 && clockMinutes < 16 * 60 ? "day" : "night";
}

// Satiety is allowed to climb well past the "healthy" 0-100 range so that
// stat-threshold endings (e.g. "satiety > 150" gluttony ending) are
// reachable. It still fits in a single save-string byte (0-255).
const SATIETY_MAX = 255;

/**
 * GameState - singleton holding the protagonist's runtime status:
 * energy, mental/physical condition, satiety, current in-game day and phase.
 * DayNightSystem mutates day/phase; ItemManager effects and other systems
 * may mutate the stat fields via `modify()`. StatusApp (and any other app)
 * reads it.
 */
class GameState {
  constructor() {
    this.day = 1;
    this.clockMinutes = 8 * 60;
    this.phase = "day"; // "day" | "night"
    this.duty = "on-duty"; // "on-duty" | "off-duty"
    this.location = "work"; // compatibility alias for the current duty mode
    this.energy = 100;
    this._mental = 100;
    this.physical = 100;
    this.satiety = 70;
    this.recoverableMentalLoss = 0;
    eventBus.on("global-variable:changed", ({ id, previous, value }) => {
      if (id !== 1) return;
      this._mental = value;
      if (previous === value) return;
      eventBus.emit("game:sanity_changed", { value, delta: value - (typeof previous === "number" ? previous : value) });
      eventBus.emit("gamestate:changed", this.snapshot());
    });
  }

  get mental() {
    return globalVariableManager.get(1) ?? this._mental;
  }

  set mental(value) {
    const next = clamp(value);
    this._mental = next;
    if (globalVariableManager.definition(1)) globalVariableManager.set(1, next);
  }

  getGameTime() {
    return this.day * 1440 + this.clockMinutes;
  }

  setClock(day, clockMinutes) {
    this.day = Math.min(MAX_GAME_DAYS, Math.max(1, Math.floor(Number(day) || 1)));
    this.clockMinutes = ((Math.floor(Number(clockMinutes) || 0) % 1440) + 1440) % 1440;
    this.phase = phaseForClock(this.clockMinutes);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  setDuty(duty) {
    this.duty = duty === "off-duty" ? "off-duty" : "on-duty";
    this.location = this.duty === "on-duty" ? "work" : "dorm";
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  advanceClock(minutes) {
    let total = this.clockMinutes + Math.max(0, Number(minutes) || 0);
    while (total >= 1440 && this.day < MAX_GAME_DAYS) {
      total -= 1440;
      this.day += 1;
    }
    if (this.day >= MAX_GAME_DAYS && total >= 1440) total = 1439;
    this.clockMinutes = total;
    this.phase = phaseForClock(this.clockMinutes);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  advancePhase({ incrementDay = true, location } = {}) {
    if (this.phase === "day") {
      this.phase = "night";
    } else {
      this.phase = "day";
      if (incrementDay) this.day = Math.min(MAX_GAME_DAYS, this.day + 1);
    }
    if (location === "work" || location === "dorm") this.location = location;
    eventBus.emit("gamestate:changed", this.snapshot());
    return this.phase;
  }

  advanceDayAtMidnight() {
    this.day = Math.min(MAX_GAME_DAYS, this.day + 1);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  modify({ energy = 0, mental = 0, physical = 0, satiety = 0 } = {}) {
    const prevMental = this.mental;
    this.energy = clamp(this.energy + energy, 0, 100);
    this.mental = clamp(this.mental + mental, 0, 256);
    this.physical = clamp(this.physical + physical, 0, 100);
    this.satiety = clamp(this.satiety + satiety, 0, SATIETY_MAX);
    // Emit a semantic sanity-change event for the achievement system whenever
    // mental (= SAN / 理智值) actually moves.  This keeps AchievementManager
    // decoupled from GameState internals.
    if (mental !== 0) {
      const actualDelta = this.mental - prevMental;
      eventBus.emit("game:sanity_changed", { value: this.mental, delta: actualDelta });
    }
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  applyMentalLoss(amount, { recoverable = false } = {}) {
    const loss = Math.max(0, Number(amount) || 0);
    if (!loss) return;
    this.mental = clamp(this.mental - loss, 0, 256);
    if (recoverable) this.recoverableMentalLoss += loss;
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  recoverMental(amount) {
    const recovery = Math.min(this.recoverableMentalLoss, Math.max(0, Number(amount) || 0));
    if (!recovery) return 0;
    this.recoverableMentalLoss -= recovery;
    this.mental = clamp(this.mental + recovery, 0, 256);
    eventBus.emit("gamestate:changed", this.snapshot());
    return recovery;
  }

  /** Overwrite every stat at once (used by SaveManager when restoring a save). */
  restore({ day, clockMinutes, phase, duty, location, energy, mental, physical, satiety, recoverableMentalLoss } = {}) {
    if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > MAX_GAME_DAYS)) throw new Error("Invalid save day");
    if (clockMinutes !== undefined && (!Number.isInteger(clockMinutes) || clockMinutes < 0 || clockMinutes >= 1440)) {
      throw new Error("Invalid save clock");
    }
    const nextDay = day === undefined ? this.day : day;
    const nextClock = clockMinutes === undefined ? this.clockMinutes : clockMinutes;
    const derivedPhase = phaseForClock(nextClock);
    if (phase !== undefined && phase !== derivedPhase) throw new Error("Inconsistent save phase");
    if (duty !== undefined && duty !== "on-duty" && duty !== "off-duty") throw new Error("Invalid save duty");
    if (location !== undefined && location !== "work" && location !== "dorm") throw new Error("Invalid save location");
    if (duty !== undefined && location !== undefined && (duty === "on-duty") !== (location === "work")) {
      throw new Error("Inconsistent save duty/location");
    }
    this.day = nextDay;
    this.clockMinutes = nextClock;
    this.phase = derivedPhase;
    this.duty = duty || (location === "dorm" ? "off-duty" : "on-duty");
    this.location = location || (this.duty === "on-duty" ? "work" : "dorm");
    if (typeof energy === "number") this.energy = clamp(energy, 0, 100);
    if (typeof mental === "number") this.mental = clamp(mental, 0, 256);
    if (typeof physical === "number") this.physical = clamp(physical, 0, 100);
    if (typeof satiety === "number") this.satiety = clamp(satiety, 0, SATIETY_MAX);
    if (typeof recoverableMentalLoss === "number") {
      this.recoverableMentalLoss = Math.max(0, recoverableMentalLoss);
    }
    eventBus.emit("gamestate:changed", this.snapshot());
    eventBus.emit("daynight:changed", { phase: this.phase, day: this.day });
  }

  snapshot() {
    return {
      day: this.day,
      clockMinutes: this.clockMinutes,
      phase: this.phase,
      duty: this.duty,
      location: this.location,
      energy: this.energy,
      mental: this.mental,
      physical: this.physical,
      satiety: this.satiety,
      recoverableMentalLoss: this.recoverableMentalLoss,
    };
  }
}

function clamp(value, min = 0, max = 256) {
  return Math.min(max, Math.max(min, value));
}

export const gameState = new GameState();
export default GameState;
