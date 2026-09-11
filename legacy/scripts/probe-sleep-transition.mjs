import { dayNightSystem } from "../js/core/DayNightSystem.js";
import { gameState } from "../js/core/GameState.js";
import { timeService } from "../js/core/TimeService.js";

timeService.config = {
  day: { workMinutes: 480 },
  night: { nightMinutes: 960 },
  fullSleepMinutes: 480,
  insufficientSleepMinutes: 360,
  sanRecoveryPerSleepHour: 0,
};
gameState.restore({
  day: 1,
  clockMinutes: 16 * 60,
  phase: "night",
  duty: "off-duty",
  location: "dorm",
  sanity: 80,
  roommateSuspicion: 0,
});
timeService.startPhase("night", 0);

const result = dayNightSystem.toggle();
if (result !== "day"
  || gameState.day !== 2
  || gameState.clockMinutes !== 8 * 60
  || gameState.phase !== "day"
  || gameState.duty !== "on-duty"
  || gameState.location !== "work") {
  throw new Error(`sleep transition failed: ${JSON.stringify({ result, state: gameState.snapshot() })}`);
}
console.log("sleep transition probe: ok");