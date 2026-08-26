import { eventBus } from "./EventBus.js";

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
    this.phase = "day"; // "day" | "night"
    this.energy = 100;
    this.mental = 100;
    this.physical = 100;
    this.satiety = 70;
  }

  advancePhase() {
    if (this.phase === "day") {
      this.phase = "night";
    } else {
      this.phase = "day";
      this.day += 1;
    }
    eventBus.emit("gamestate:changed", this.snapshot());
    return this.phase;
  }

  modify({ energy = 0, mental = 0, physical = 0, satiety = 0 } = {}) {
    this.energy = clamp(this.energy + energy);
    this.mental = clamp(this.mental + mental);
    this.physical = clamp(this.physical + physical);
    this.satiety = clamp(this.satiety + satiety);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  /** Overwrite every stat at once (used by SaveManager when restoring a save). */
  restore({ day, phase, energy, mental, physical, satiety } = {}) {
    if (typeof day === "number") this.day = day;
    if (phase === "day" || phase === "night") this.phase = phase;
    if (typeof energy === "number") this.energy = clamp(energy);
    if (typeof mental === "number") this.mental = clamp(mental);
    if (typeof physical === "number") this.physical = clamp(physical);
    if (typeof satiety === "number") this.satiety = clamp(satiety);
    eventBus.emit("gamestate:changed", this.snapshot());
    eventBus.emit("daynight:changed", { phase: this.phase, day: this.day });
  }

  snapshot() {
    return {
      day: this.day,
      phase: this.phase,
      energy: this.energy,
      mental: this.mental,
      physical: this.physical,
      satiety: this.satiety,
    };
  }
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export const gameState = new GameState();
export default GameState;
