import { gameState } from "./GameState.js";
import { keywordManager } from "./KeywordManager.js";
import { itemManager } from "./ItemManager.js";
import { windowManager } from "./WindowManager.js";
import { scheduleData } from "./ScheduleData.js";
import { timeService } from "./TimeService.js";
import { npcStateManager } from "./NpcStateManager.js";
import { spellManager } from "./SpellManager.js";
import { itemPlacementManager } from "./ItemPlacementManager.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";
import { workQueue, socialQueue, mainQueue } from "./ScheduleQueue.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";

import { cgManager } from "./CGManager.js";
import { endingManager } from "./EndingManager.js";
import { onboardingManager } from "./OnboardingManager.js";
import { MAX_GAME_DAYS } from "./GameRules.js";
import { turtleSoupManager } from "./TurtleSoupManager.js";
import { itemEffectHistory } from "./ItemEffectHistory.js";

// v17 = v16 plus TurtleSoup branch state.
// v18 = v17 plus the active ending ID and priority.
// v19 = v18 plus daily seaside spell usage.
// v20 = v19 plus resumable medical incidents in workQueue.
// v21 = v20 plus the migration of medical money ownership to global variable 2.
// v22 = v21 plus fixed complaint/riot arrival times.
// v23 = v22 plus persisted item/object effect history.
const SAVE_FORMAT_VERSION = 23;

/** Fixed order used to encode a window's appId as a single byte index. */
const WINDOW_APP_IDS = ["his", "social", "chatgtp", "notebook", "status", "settings", "achievements", "calendar"];

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * SaveManager packs the complete v22 game state into a version-prefixed JSON
 * payload and exports the bytes as a downloaded file. Loading reverses the
 * process from a user-selected File object.
 */
class SaveManager {
  constructor() {
    this.itemIds = [];
    this.keywordIds = [];
    this._launchers = {};
    this._initPromise = null;
  }

  /**
   * Preload every data file needed to build the canonical index tables
   * (idempotent, and safe to call concurrently from multiple callers - the
   * in-flight promise is cached so overlapping callers all await the same
   * init instead of racing past a boolean guard set only after the
   * `await` resolves).
   */
  async init() {
    if (!this._initPromise) {
      this._initPromise = this._doInit();
    }
    return this._initPromise;
  }

  async _doInit() {
    await Promise.all([scheduleData.init(), globalVariableManager.init(), keywordManager.load(), itemManager.load(), npcStateManager.load(), itemPlacementManager.load(), medicalCaseManager.load()]);

    this.itemIds = itemManager.allDefIds();
    this.placementIds = itemPlacementManager.all().map((placement) => placement.id);
    this.keywordIds = [...keywordManager.definitions.keys()];
  }

  /** Register the appId -> launch() functions used to reopen windows on load. */
  registerLaunchers(launcherMap) {
    this._launchers = launcherMap || {};
  }

  /** Download the current game state as a binary save file. */
  saveToFile(fileName = `cultists-save-v${SAVE_FORMAT_VERSION}.sav`) {
    const bytes = this._encode();
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return fileName;
  }

  /** Decode a legacy/base64 save string and restore it without touching the URL. */
  loadFromString(str) {
    try {
      const bytes = base64UrlDecode(str);
      this._decode(bytes);
      return true;
    } catch (err) {
      endingManager.endRestore();
      console.error("[SaveManager] Failed to load save string:", err);
      return false;
    }
  }

  /** Read and restore a save file selected by the user. */
  async loadFromFile(file) {
    if (!file || typeof file.arrayBuffer !== "function") return false;
    try {
      this._decode(new Uint8Array(await file.arrayBuffer()));
      return true;
    } catch (err) {
      endingManager.endRestore();
      console.error("[SaveManager] Failed to load save file:", err);
      return false;
    }
  }

  _encode() {
    const payload = {
      gameState: gameState.snapshot(),
      timeService: timeService.snapshot(),
      workQueue: workQueue.snapshot(),
      socialQueue: socialQueue.snapshot(),
      mainQueue: mainQueue.snapshot(),
      keywords: keywordManager.all().map((kw) => ({ id: kw.id, collectedDay: kw.collectedDay })),
      inventory: itemManager.all(),
      medical: medicalCaseManager.snapshot(),
      npcState: npcStateManager.snapshot(),
      globalVariables: globalVariableManager.snapshot(),
      windows: windowManager.windowSnapshot().map(({ appId, x, y }) => ({ appId, x, y })),
      spells: spellManager.all(),
      spellUsage: spellManager.usageSnapshot(),
      scheduledAdds: scheduleData.snapshotScheduled(),
      favorability: favorabilityManager.snapshot(),
      itemPlacements: itemPlacementManager.snapshot(),
      ending: endingManager.snapshot(),
      cg: cgManager.snapshot(),
      onboarding: onboardingManager.snapshot(),
      turtleSoup: turtleSoupManager.snapshot(),
      itemEffectHistory: itemEffectHistory.snapshot(),
    };
    return Uint8Array.from([SAVE_FORMAT_VERSION, ...new TextEncoder().encode(JSON.stringify(payload))]);
  }

  _restoreWindows(windowEntries) {
    const savedAppIds = new Set(windowEntries.map((window) => window.appId));
    WINDOW_APP_IDS.forEach((appId) => {
      if (!savedAppIds.has(appId) && windowManager.getByAppId(appId)) windowManager.closeByAppId(appId);
    });
    windowEntries.forEach(({ appId, x, y }) => {
      if (!WINDOW_APP_IDS.includes(appId)) return;
      if (!windowManager.getByAppId(appId) && this._launchers[appId]) this._launchers[appId]();
      windowManager.moveWindow(appId, Number(x) || 0, Number(y) || 0);
    });
  }

  _decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 7) throw new Error("Invalid save data");
    let i = 0;
    const version = bytes[i++];
    if (version !== SAVE_FORMAT_VERSION) throw new Error("Unsupported save version");
    const payload = JSON.parse(new TextDecoder().decode(bytes.slice(i)));
    if (!payload || !payload.gameState || !Array.isArray(payload.workQueue) || !Array.isArray(payload.socialQueue)
      || !Array.isArray(payload.mainQueue || [])
      || !payload.favorability || !Array.isArray(payload.itemPlacements)
      || typeof payload.ending !== "object") {
      throw new Error("Invalid save data");
    }
    if (!Number.isInteger(payload.gameState.day) || payload.gameState.day < 1 || payload.gameState.day > MAX_GAME_DAYS) {
      throw new Error("Save belongs to an unsupported game day");
    }
    endingManager.beginRestore();
    try {
      const globalVariables = payload.globalVariables || [];
      const hasGlobalVariable = (id) => globalVariables.some((entry) => Number(entry.id) === id);
      globalVariableManager.restore(globalVariables);
      const gameStatePayload = { ...payload.gameState };
      if (hasGlobalVariable(1)) delete gameStatePayload.mental;
      gameState.restore(gameStatePayload);
      timeService.restore(payload.timeService || {});
      workQueue.restore(payload.workQueue);
      socialQueue.restore(payload.socialQueue);
      mainQueue.restore(payload.mainQueue || []);
      scheduleData.restoreScheduled(payload.scheduledAdds || []);
      keywordManager.restoreCollected(payload.keywords || []);
      itemManager.restoreInventory(payload.inventory || []);
      spellManager.restore(payload.spells || []);
      spellManager.restoreUsage(payload.spellUsage || {});
      npcStateManager.restore(payload.npcState || {}, { useGlobalValues: hasGlobalVariable(5) || globalVariables.some((entry) => {
        const id = Number(entry.id);
        return id >= 60 && id <= 79;
      }) });
      medicalCaseManager.restore(payload.medical || {});
      favorabilityManager.restore(payload.favorability || {}, { useGlobalValues: globalVariables.some((entry) => {
        const id = Number(entry.id);
        return id >= 40 && id <= 59;
      }) });
      itemPlacementManager.restore(payload.itemPlacements || []);

      endingManager.restore(payload.ending || {});
      cgManager.restore(payload.cg || {});
      onboardingManager.restore(payload.onboarding || {});
      turtleSoupManager.restore(payload.turtleSoup || {});
      itemEffectHistory.restore(payload.itemEffectHistory || []);
      scheduleData.restoreAt(gameState.day, gameState.clockMinutes);
      this._restoreWindows(Array.isArray(payload.windows) ? payload.windows : []);
    } finally {
      endingManager.endRestore();
    }
    return;
  }
}

export const saveManager = new SaveManager();
export default SaveManager;
