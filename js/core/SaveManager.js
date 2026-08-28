import { gameState } from "./GameState.js";
import { keywordManager } from "./KeywordManager.js";
import { itemManager } from "./ItemManager.js";
import { dialogueProgress } from "./DialogueProgress.js";
import { windowManager } from "./WindowManager.js";
import { scheduleData } from "./ScheduleData.js";
import { actionBudget } from "./ActionBudget.js";
import { favorabilityManager, NPC_IDS } from "./FavorabilityManager.js";
import { npcStateManager } from "./NpcStateManager.js";
import { spellManager } from "./SpellManager.js";
import { itemPlacementManager } from "./ItemPlacementManager.js";
import { medicalCaseManager } from "./MedicalCaseManager.js";
import { workQueue, socialQueue } from "./ScheduleQueue.js";
import { globalVariableManager } from "./GlobalVariableManager.js";

// v11 = v10 plus spell list in JSON payload.
const SAVE_FORMAT_VERSION = 11;

/** Fixed order used to encode a window's appId as a single byte index. */
const WINDOW_APP_IDS = ["his", "social", "chatgtp", "notebook", "status", "settings", "monitor", "achievements", "calendar"];

function clampByte(value, max = 255) {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(max, n));
}

function push16(bytes, value) {
  const v = Math.round(Math.max(0, Math.min(0xffff, Number(value) || 0)));
  bytes.push((v >> 8) & 0xff);
  bytes.push(v & 0xff);
}

function read16(bytes, i) {
  return ((bytes[i] || 0) << 8) | (bytes[i + 1] || 0);
}

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
 * SaveManager - packs the entire game state (stats, day/phase/location, collected
 * keywords, inventory, dialogue progress, open windows + their position and
 * stacking order) into a short binary blob, base64url-encodes it, and writes
 * it to `location.search` so a save is just "the current URL". Loading
 * reverses the process.
 *
 * To keep the encoding compact and free of plaintext variable names/values,
 * every reference (keyword, item, HIS/Social actor + dialogue node) is
 * stored as a small integer index into canonical tables built once at boot
 * from the fully-loaded data files - never as a literal id string.
 *
 * Byte layout (all indices 0-based unless noted):
 *   [0]      format version
 *   [1]      day (0-255)
 *   [2]      phase (0 = day, 1 = night)
 *   [3]      location (0 = work, 1 = dorm)
 *   [4-7]    energy, mental, physical, satiety (0-255 each)
 *   [8]      open-window count N (0-len(WINDOW_APP_IDS)), ordered bottom-to-top
 *   [9..]    per window (5 bytes): 1-byte appId index into WINDOW_APP_IDS,
 *            2-byte x, 2-byte y - re-opening/positioning them in this same
 *            (ascending z) order on load restores the original stacking.
 *   [next]   HIS actor index + 1 (0 = none)
 *   [next]   HIS dialogue node index + 1 (0 = none / not started)
 *   [next]   Social actor index + 1 (0 = none)
 *   [next]   Social dialogue node index + 1 (0 = none / not started)
 *   [next]   collected-keyword count (0-255)
 *   [...]    per keyword: 2-byte keyword index + 1-byte collectedDay
 *   [next]   inventory-entry count (0-255)
 *   [...]    per item: 2-byte item index + 1-byte held count
 *   [v8]     placement count + 1-byte placed flag per world-item placement
 *   [v9]     2-byte UTF-8 length + medical case/income JSON payload
 */
class SaveManager {
  constructor() {
    this.hisActors = [];
    this.socialActors = [];
    this.itemIds = [];
    this.keywordIds = [];
    this._launchers = {};
    this.npcIds = [];
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
    await Promise.all([scheduleData.init(), globalVariableManager.init(), keywordManager.load(), itemManager.load(), favorabilityManager.load(), npcStateManager.load(), itemPlacementManager.load(), medicalCaseManager.load()]);

    const entries = await scheduleData.loadAllEntries();
    this.hisActors = this._buildActorIndex(entries, "patients");
    this.socialActors = this._buildActorIndex(entries, "contacts");
    this.itemIds = itemManager.allDefIds();
    this.placementIds = itemPlacementManager.all().map((placement) => placement.id);
    this.keywordIds = [...keywordManager.definitions.keys()];
    this.npcIds = [...new Set(favorabilityManager.npcs.map((npc) => npc.id))];
  }

  _buildActorIndex(entries, listKey) {
    const actors = [];
    const seen = new Set();
    entries.forEach(({ data }) => {
      (data[listKey] || []).forEach((actor) => {
        if (seen.has(actor.id)) return;
        seen.add(actor.id);
        const nodeKeys = actor.dialogueTree ? Object.keys(actor.dialogueTree.nodes || {}) : [];
        actors.push({ id: actor.id, nodeKeys });
      });
    });
    return actors;
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
      medicalCaseManager.endRestore();
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
      actionBudget: actionBudget.snapshot(),
      workQueue: workQueue.snapshot(),
      socialQueue: socialQueue.snapshot(),
      keywords: keywordManager.all().map((kw) => ({ id: kw.id, collectedDay: kw.collectedDay })),
      inventory: itemManager.all(),
      medical: medicalCaseManager.snapshot(),
      globalVariables: globalVariableManager.snapshot(),
      windows: windowManager.windowSnapshot().map(({ appId, x, y }) => ({ appId, x, y })),
      spells: spellManager.all(),
    };
    return Uint8Array.from([SAVE_FORMAT_VERSION, ...new TextEncoder().encode(JSON.stringify(payload))]);

    /* Legacy binary encoder retained below only as historical reference. */
    const bytes = [];
    bytes.push(SAVE_FORMAT_VERSION);
    bytes.push(clampByte(gameState.day));
    bytes.push(gameState.phase === "night" ? 1 : 0);
    bytes.push(gameState.location === "dorm" ? 1 : 0);
    bytes.push(clampByte(gameState.energy));
    bytes.push(clampByte(gameState.mental));
    bytes.push(clampByte(gameState.physical));
    bytes.push(clampByte(gameState.satiety));
    const budget = actionBudget.snapshot();
    push16(bytes, gameState.recoverableMentalLoss);
    bytes.push(clampByte(budget.used.dialogue));
    bytes.push(clampByte(budget.used.inspect));
    bytes.push(clampByte(budget.limits.dialogueLimit));
    bytes.push(clampByte(budget.limits.inspectLimit));
    push16(bytes, budget.phaseMinutes);
    push16(bytes, budget.pendingNightDebt);
    bytes.push(clampByte(budget.insufficientSleepStreak));
    push16(bytes, budget.sleepHistory[0] || 0);
    push16(bytes, budget.sleepHistory[1] || 0);
    push16(bytes, budget.sleepHistory[2] || 0);

    const windows = windowManager.windowSnapshot().slice(0, WINDOW_APP_IDS.length);
    bytes.push(windows.length);
    windows.forEach(({ appId, x, y }) => {
      const idx = WINDOW_APP_IDS.indexOf(appId);
      bytes.push(clampByte(idx));
      push16(bytes, x);
      push16(bytes, y);
    });

    const hisProgress = dialogueProgress.get("his");
    const hisActorIdx = this.hisActors.findIndex((a) => a.id === hisProgress.actorId);
    const hisNodeIdx =
      hisActorIdx >= 0 ? this.hisActors[hisActorIdx].nodeKeys.indexOf(hisProgress.nodeId) : -1;
    bytes.push(clampByte(hisActorIdx + 1));
    bytes.push(clampByte(hisNodeIdx + 1));

    const socialProgress = dialogueProgress.get("social");
    const socialActorIdx = this.socialActors.findIndex((a) => a.id === socialProgress.actorId);
    const socialNodeIdx =
      socialActorIdx >= 0
        ? this.socialActors[socialActorIdx].nodeKeys.indexOf(socialProgress.nodeId)
        : -1;
    bytes.push(clampByte(socialActorIdx + 1));
    bytes.push(clampByte(socialNodeIdx + 1));

    const keywords = keywordManager.all().slice(0, 255);
    bytes.push(keywords.length);
    keywords.forEach((kw) => {
      const idx = this.keywordIds.indexOf(kw.id);
      push16(bytes, idx >= 0 ? idx : 0xffff);
      bytes.push(clampByte(kw.collectedDay));
    });

    const items = itemManager.all().slice(0, 255);
    bytes.push(items.length);
    items.forEach(({ id, count }) => {
      const idx = this.itemIds.indexOf(id);
      push16(bytes, idx >= 0 ? idx : 0xffff);
      bytes.push(clampByte(count));
    });

    // v7: data-driven NPC state table – id order comes from npcs.json.
    bytes.push(clampByte(this.npcIds.length));
    this.npcIds.forEach((id) => {
      bytes.push(clampByte(favorabilityManager.get(id)));
      bytes.push(clampByte(npcStateManager.get(id)));
      bytes.push(favorabilityManager.hadPositive.has(id) ? 1 : 0);
      bytes.push(npcStateManager.isOffline(id) ? 1 : 0);
    });

    // v8+: conditional world-item placements, in item_placements.json order.
    bytes.push(clampByte(this.placementIds.length));
    this.placementIds.forEach((id) => bytes.push(itemPlacementManager.isPlaced(id) ? 1 : 0));

    const medicalState = new TextEncoder().encode(JSON.stringify(medicalCaseManager.snapshot()));
    push16(bytes, medicalState.length);
    medicalState.forEach((byte) => bytes.push(byte));

    return Uint8Array.from(bytes);
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
    if (!payload || !payload.gameState || !Array.isArray(payload.workQueue) || !Array.isArray(payload.socialQueue)) {
      throw new Error("Invalid save data");
    }
    globalVariableManager.restore(payload.globalVariables || []);
    gameState.restore(payload.gameState);
    actionBudget.restore(payload.actionBudget || {});
    workQueue.restore(payload.workQueue);
    socialQueue.restore(payload.socialQueue);
    keywordManager.restoreCollected(payload.keywords || []);
    itemManager.restoreInventory(payload.inventory || []);
    spellManager.restore(payload.spells || []);
    medicalCaseManager.restore(payload.medical || {});
    scheduleData.restoreAt(gameState.day, gameState.clockMinutes);
    this._restoreWindows(Array.isArray(payload.windows) ? payload.windows : []);
    return;

    /* Legacy binary decoder retained below only as historical reference. */
    const day = bytes[i++];
    const phase = bytes[i++] === 1 ? "night" : "day";
    // location byte present from v5 onward; advance i unconditionally when present
    const location = version >= 5 ? (bytes[i++] === 1 ? "dorm" : "work") : "work";
    const energy = bytes[i++];
    const mental = bytes[i++];
    const physical = bytes[i++];
    const satiety = bytes[i++];
    const recoverableMentalLoss = version >= 4 ? read16(bytes, i) : version === 3 ? bytes[i] : 0;
    if (version >= 4) i += 2;
    else if (version === 3) i += 1;
    const budgetSnapshot = version >= 3
      ? version >= 4
        ? {
            used: { dialogue: bytes[i++], inspect: bytes[i++] },
            limits: { dialogueLimit: bytes[i++], inspectLimit: bytes[i++] },
            phaseMinutes: read16(bytes, (i += 0)),
            pendingNightDebt: read16(bytes, (i += 2)),
            insufficientSleepStreak: bytes[i++],
            sleepHistory: [read16(bytes, i), read16(bytes, i + 2), read16(bytes, i + 4)].filter((n) => n > 0),
          }
        : {
          used: { dialogue: bytes[i++], inspect: bytes[i++] },
          limits: { dialogueLimit: bytes[i++], inspectLimit: bytes[i++] },
          phaseMinutes: bytes[i++],
          pendingNightDebt: bytes[i++],
          insufficientSleepStreak: bytes[i++],
          sleepHistory: [bytes[i++], bytes[i++], bytes[i++]].filter((n) => n > 0),
        }
      : null;
    if (version >= 4) i += 6;

    const windowCount = bytes[i++] || 0;
    const windowEntries = [];
    for (let w = 0; w < windowCount; w += 1) {
      const appIdIdx = bytes[i++];
      const x = read16(bytes, i);
      i += 2;
      const y = read16(bytes, i);
      i += 2;
      const appId = WINDOW_APP_IDS[appIdIdx];
      if (appId) windowEntries.push({ appId, x, y });
    }

    const hisActorIdx = bytes[i++] - 1;
    const hisNodeIdx = bytes[i++] - 1;
    const socialActorIdx = bytes[i++] - 1;
    const socialNodeIdx = bytes[i++] - 1;

    const keywordCount = bytes[i++] || 0;
    const keywordEntries = [];
    for (let k = 0; k < keywordCount; k += 1) {
      const idx = read16(bytes, i);
      i += 2;
      const collectedDay = bytes[i++];
      const id = this.keywordIds[idx];
      if (id) keywordEntries.push({ id, collectedDay });
    }

    const itemCount = bytes[i++] || 0;
    const itemEntries = [];
    for (let n = 0; n < itemCount; n += 1) {
      const idx = read16(bytes, i);
      i += 2;
      const count = bytes[i++];
      const id = this.itemIds[idx];
      if (id) itemEntries.push({ id, count });
    }

    medicalCaseManager.beginRestore();
    gameState.restore({ day, phase, location, energy, mental, physical, satiety, recoverableMentalLoss });
    if (budgetSnapshot) actionBudget.restore(budgetSnapshot);
    keywordManager.restoreCollected(keywordEntries);
    itemManager.restoreInventory(itemEntries);

    // v3-v6: fixed favourability table. v7 uses the data-driven table below.
    // Guard with remaining byte count so v2 saves load cleanly (no crash).
    if (version < 7 && i + NPC_IDS.length < bytes.length) {
      const favValues = {};
      NPC_IDS.forEach((id) => { favValues[id] = bytes[i++]; });
      const favFlags = bytes[i++] || 0;
      const hadPositive = NPC_IDS.filter((_, idx) => favFlags & (1 << idx));
      favorabilityManager.restore({ values: favValues, hadPositive });
    }
    if (version >= 7) {
      const npcCount = bytes[i++] || 0;
      const favValues = {};
      const sanValues = {};
      const hadPositive = [];
      const offline = [];
      for (let n = 0; n < npcCount && i + 3 < bytes.length; n += 1) {
        const id = this.npcIds[n];
        const favorability = bytes[i++];
        const san = bytes[i++];
        if (bytes[i++]) hadPositive.push(id);
        if (bytes[i++]) offline.push(id);
        if (id) { favValues[id] = favorability; sanValues[id] = san; }
      }
      favorabilityManager.restore({ values: favValues, hadPositive });
      npcStateManager.restore({ san: sanValues, offline });
    }
    if (version >= 8) {
      const placementCount = bytes[i++] || 0;
      const placementEntries = [];
      for (let n = 0; n < placementCount && i < bytes.length; n += 1) {
        const id = this.placementIds[n];
        const placed = bytes[i++] === 1;
        if (id) placementEntries.push({ id, placed });
      }
      itemPlacementManager.restore(placementEntries);
    }
    if (version >= 9) {
      const medicalLength = read16(bytes, i);
      i += 2;
      if (i + medicalLength > bytes.length) throw new Error("Invalid save data");
      const medicalBytes = bytes.slice(i, i + medicalLength);
      i += medicalLength;
      medicalCaseManager.restore(JSON.parse(new TextDecoder().decode(medicalBytes)));
    } else {
      medicalCaseManager.restore();
    }
    medicalCaseManager.endRestore();

    if (hisActorIdx >= 0 && this.hisActors[hisActorIdx]) {
      const actor = this.hisActors[hisActorIdx];
      const nodeId = hisNodeIdx >= 0 ? actor.nodeKeys[hisNodeIdx] : null;
      dialogueProgress.set("his", actor.id, nodeId || null);
    } else {
      dialogueProgress.reset("his");
    }
    if (socialActorIdx >= 0 && this.socialActors[socialActorIdx]) {
      const actor = this.socialActors[socialActorIdx];
      const nodeId = socialNodeIdx >= 0 ? actor.nodeKeys[socialNodeIdx] : null;
      dialogueProgress.set("social", actor.id, nodeId || null);
    } else {
      dialogueProgress.reset("social");
    }

    // Close anything open that isn't part of the saved layout, then
    // (re)open + reposition the saved windows in ascending-z order so
    // their relative stacking is restored.
    const savedAppIds = new Set(windowEntries.map((w) => w.appId));
    WINDOW_APP_IDS.forEach((appId) => {
      if (!savedAppIds.has(appId) && windowManager.getByAppId(appId)) {
        windowManager.closeByAppId(appId);
      }
    });
    windowEntries.forEach(({ appId, x, y }) => {
      if (!windowManager.getByAppId(appId) && this._launchers[appId]) {
        this._launchers[appId]();
      }
      windowManager.moveWindow(appId, x, y);
    });
  }
}

export const saveManager = new SaveManager();
export default SaveManager;
