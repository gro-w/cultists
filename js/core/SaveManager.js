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
import { workQueue, socialQueue, chatgtpQueue, realtimeQueue } from "./ScheduleQueue.js";
import { globalVariableManager } from "./GlobalVariableManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";
import { dialogueProgress } from "./DialogueProgress.js";
import { cgManager } from "./CGManager.js";
import { endingManager } from "./EndingManager.js";
import { MAX_GAME_DAYS } from "./GameRules.js";

// v15 = v14 plus CGManager snapshot (activeCgId).
const SAVE_FORMAT_VERSION = 15;

/** Fixed order used to encode a window's appId as a single byte index. */
const WINDOW_APP_IDS = ["his", "social", "chatgtp", "notebook", "status", "settings", "monitor", "achievements", "calendar"];

function base64UrlEncode(uint8arr) {
  let binary = "";
  uint8arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * SaveManager packs the complete v13 game state into a version-prefixed JSON
 * payload, base64url-encodes it, and writes it to `location.search` so a save
 * is represented by the current URL. Loading reverses the process.
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

  /** Encode the current game state and write it to the URL's search string. */
  save() {
    const bytes = this._encode();
    const encoded = base64UrlEncode(bytes);
    const url = `${window.location.pathname}?${encoded}`;
    window.history.replaceState(null, "", url);
    return window.location.href;
  }

  /** Decode a save string (without the leading "?") and restore it. */
  loadFromString(str, { updateLocation = true } = {}) {
    try {
      const bytes = base64UrlDecode(str);
      this._decode(bytes);
      if (updateLocation) {
        window.history.replaceState(null, "", `${window.location.pathname}?${str}`);
      }
      return true;
    } catch (err) {
      endingManager.endRestore();
      console.error("[SaveManager] Failed to load save string:", err);
      return false;
    }
  }

  /** Called once at boot: restores from `location.search` if present. */
  loadFromLocation() {
    const search = window.location.search.replace(/^\?/, "");
    if (!search) return false;
    return this.loadFromString(search);
  }

  _encode() {
    const payload = {
      gameState: gameState.snapshot(),
      timeService: timeService.snapshot(),
      workQueue: workQueue.snapshot(),
      socialQueue: socialQueue.snapshot(),
      chatgtpQueue: chatgtpQueue.snapshot(),
      realtimeQueue: realtimeQueue.snapshot(),
      keywords: keywordManager.all().map((kw) => ({ id: kw.id, collectedDay: kw.collectedDay })),
      inventory: itemManager.all(),
      medical: medicalCaseManager.snapshot(),
      npcState: npcStateManager.snapshot(),
      globalVariables: globalVariableManager.snapshot(),
      windows: windowManager.windowSnapshot().map(({ appId, x, y }) => ({ appId, x, y })),
      spells: spellManager.all(),
      scheduledAdds: scheduleData.snapshotScheduled(),
      favorability: favorabilityManager.snapshot(),
      itemPlacements: itemPlacementManager.snapshot(),
      dialogueProgress: dialogueProgress.snapshot(),
      ending: endingManager.snapshot(),
      cg: cgManager.snapshot(),
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
      || !Array.isArray(payload.chatgtpQueue || []) || !Array.isArray(payload.realtimeQueue || [])
      || !payload.favorability || !Array.isArray(payload.itemPlacements)
      || !payload.dialogueProgress || typeof payload.ending !== "object") {
      throw new Error("Invalid save data");
    }
    if (!Number.isInteger(payload.gameState.day) || payload.gameState.day < 1 || payload.gameState.day > MAX_GAME_DAYS) {
      throw new Error("Save belongs to an unsupported game day");
    }
    endingManager.beginRestore();
    try {
      globalVariableManager.restore(payload.globalVariables || []);
      gameState.restore(payload.gameState);
      timeService.restore(payload.timeService || {});
      workQueue.restore(payload.workQueue);
      socialQueue.restore(payload.socialQueue);
      chatgtpQueue.restore(payload.chatgtpQueue || []);
      realtimeQueue.restore(payload.realtimeQueue || []);
      scheduleData.restoreScheduled(payload.scheduledAdds || []);
      keywordManager.restoreCollected(payload.keywords || []);
      itemManager.restoreInventory(payload.inventory || []);
      spellManager.restore(payload.spells || []);
      npcStateManager.restore(payload.npcState || {});
      medicalCaseManager.restore(payload.medical || {});
      favorabilityManager.restore(payload.favorability || {});
      itemPlacementManager.restore(payload.itemPlacements || []);
      dialogueProgress.restore(payload.dialogueProgress || {});
      endingManager.restore(payload.ending || {});
      cgManager.restore(payload.cg || {});
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
