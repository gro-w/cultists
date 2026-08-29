import { eventBus } from "./EventBus.js";
import { MAX_GAME_DAYS } from "./GameRules.js";

function phaseForClock(clockMinutes) {
  return clockMinutes >= 8 * 60 && clockMinutes < 16 * 60 ? "day" : "night";
}

/**
 * GameState - singleton holding the protagonist's runtime status:
 * sanity (理智值), roommateSuspicion (室友怀疑度), current in-game day/phase.
 *
 * Fields removed vs. pre-refactor:
 *   energy, physical, satiety  – were test-only values, never used in shipped content
 *   recoverableMentalLoss       – merged into sanity (single value, no split tracking)
 *
 * Fields renamed:
 *   mental → sanity  (getter alias `mental` kept for backward compat with data files)
 *
 * Fields added:
 *   roommateSuspicion  – rises when player skips work or is caught snooping at night
 */
class GameState {
  constructor() {
    this.day = 1;
    this.clockMinutes = 8 * 60;
    this.phase = "day";            // "day" | "night"
    this.duty = "on-duty";         // "on-duty" | "off-duty"
    this.location = "work";        // compatibility alias for the current duty mode
    this.sanity = 100;             // 理智值 (0–100)
    this.roommateSuspicion = 0;    // 室友怀疑度 (0–100)
  }

  /** Backward-compat alias so data-driven `statChanges.mental` keeps working. */
  get mental() { return this.sanity; }

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

  /**
   * Apply stat deltas.
   * Accepts both `sanity` and `mental` (alias) so existing data-file
   * `statChanges.mental` keeps working without edits.
   */
  modify({ sanity = 0, mental = 0, roommateSuspicion = 0 } = {}) {
    const sanDelta = sanity + mental; // merge alias
    const prevSanity = this.sanity;
    this.sanity = clamp(this.sanity + sanDelta);
    this.roommateSuspicion = clamp(this.roommateSuspicion + roommateSuspicion);
    if (sanDelta !== 0) {
      const actualDelta = this.sanity - prevSanity;
      eventBus.emit("game:sanity_changed", { value: this.sanity, delta: actualDelta });
    }
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  /** Direct sanity loss (simplified — no separate recoverable tracking). */
  applyMentalLoss(amount) {
    const loss = Math.max(0, Number(amount) || 0);
    if (!loss) return;
    this.sanity = clamp(this.sanity - loss);
    eventBus.emit("game:sanity_changed", { value: this.sanity, delta: -loss });
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  /** Sanity recovery (kept for API compatibility with TimeService). */
  recoverMental(amount) {
    const gain = Math.max(0, Number(amount) || 0);
    if (!gain) return 0;
    const prev = this.sanity;
    this.sanity = clamp(this.sanity + gain);
    const actual = this.sanity - prev;
    if (actual) eventBus.emit("game:sanity_changed", { value: this.sanity, delta: actual });
    eventBus.emit("gamestate:changed", this.snapshot());
    return actual;
  }

  /** Raise roommate suspicion (convenience, emits gamestate:changed). */
  raiseSuspicion(amount) {
    const delta = Math.max(0, Number(amount) || 0);
    if (!delta) return;
    this.roommateSuspicion = clamp(this.roommateSuspicion + delta);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  /** Overwrite every stat at once (used by SaveManager when restoring a save). */
  restore({ day, clockMinutes, phase, duty, location, sanity, mental, roommateSuspicion } = {}) {
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
    // Accept both `sanity` (v14) and `mental` (v13 migration)
    const sanVal = sanity ?? mental;
    if (typeof sanVal === "number") this.sanity = clamp(sanVal);
    if (typeof roommateSuspicion === "number") this.roommateSuspicion = clamp(roommateSuspicion);
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
      sanity: this.sanity,
      mental: this.sanity,       // backward-compat alias for listeners / achievements.json
      roommateSuspicion: this.roommateSuspicion,
    };
  }
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export const gameState = new GameState();
export default GameState;
