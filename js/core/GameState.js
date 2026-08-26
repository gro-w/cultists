import { eventBus } from "./EventBus.js";

/**
 * GameState - singleton holding the protagonist's runtime status:
 * energy, mental/physical condition, current in-game day and phase.
 * DayNightSystem mutates this; StatusApp (and any other app) reads it.
 */
class GameState {
  constructor() {
    this.day = 1;
    this.phase = "day"; // "day" | "night"
    this.energy = 100;
    this.mental = 100;
    this.physical = 100;
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

  modify({ energy = 0, mental = 0, physical = 0 } = {}) {
    this.energy = clamp(this.energy + energy);
    this.mental = clamp(this.mental + mental);
    this.physical = clamp(this.physical + physical);
    eventBus.emit("gamestate:changed", this.snapshot());
  }

  snapshot() {
    return {
      day: this.day,
      phase: this.phase,
      energy: this.energy,
      mental: this.mental,
      physical: this.physical,
    };
  }
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export const gameState = new GameState();
export default GameState;
