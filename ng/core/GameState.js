export class GameState {
  constructor(initial = {}) {
    this.replace({
      day: 1,
      phase: "day",
      duty: "on-duty",
      location: "work",
      energy: 100,
      mental: 100,
      physical: 100,
      satiety: 100,
      ...initial,
    });
  }

  replace(snapshot = {}) { Object.assign(this, snapshot); }
  snapshot() { return { day: this.day, phase: this.phase, duty: this.duty, location: this.location, energy: this.energy, mental: this.mental, physical: this.physical, satiety: this.satiety }; }
  restore(snapshot) { this.replace(snapshot); }
}

export default GameState;
