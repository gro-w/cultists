import { gameState } from "./GameState.js";
import { itemManager } from "./ItemManager.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { actionBudget } from "./ActionBudget.js";

const GAME_STATS = new Set(["energy", "mental", "physical", "satiety", "recoverableMentalLoss"]);

export function getStatValue(statId) {
  const id = String(statId ?? "");
  if (GAME_STATS.has(id)) return gameState[id];
  if (id.startsWith("npcSan:")) return npcStateManager.get(id.slice(7));
  if (id.startsWith("favorability:")) return favorabilityManager.get(id.slice(14));
  if (id === "actionBudget:phaseMinutes") return actionBudget.phaseMinutes;
  if (id === "actionBudget:dialogue") return actionBudget.used.dialogue;
  if (id === "actionBudget:inspect") return actionBudget.used.inspect;
  if (id === "gameTime") return gameState.day * 1440 + gameState.clockMinutes;
  return undefined;
}

export function modifyStatValue(statId, delta) {
  const id = String(statId ?? "");
  const change = Number(delta);
  if (!Number.isFinite(change)) throw new Error(`Invalid stat change: ${statId}`);
  if (GAME_STATS.has(id)) {
    gameState.modify({ [id]: change });
    return gameState[id];
  }
  if (id.startsWith("npcSan:")) {
    const npcId = id.slice(7);
    npcStateManager.modify(npcId, change);
    return npcStateManager.get(npcId);
  }
  if (id.startsWith("favorability:")) {
    const npcId = id.slice(14);
    favorabilityManager.modify(npcId, change);
    return favorabilityManager.get(npcId);
  }
  if (id === "actionBudget:phaseMinutes") throw new Error("Action budget elapsed time is read-only");
  throw new Error(`Unknown stat: ${statId}`);
}

export function getScheduleValueContext() {
  return { gameState, itemManager, globalVariableManager, npcStateManager, favorabilityManager, actionBudget };
}
