import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";
import { keywordManager } from "./KeywordManager.js";
import { itemManager } from "./ItemManager.js";
import { dialogueProgress } from "./DialogueProgress.js";
import { windowManager } from "./WindowManager.js";

const SAVE_FORMAT_VERSION = 1;

/** Fixed order used for the open-windows bitmask byte. */
const WINDOW_APP_IDS = ["his", "social", "chatgtp", "notebook", "status", "settings"];

function clampByte(value, max = 255) {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(max, n));
}

function push16(bytes, value) {
  const v = Math.max(0, Math.min(0xffff, value));
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
 * SaveManager - packs the entire game state (stats, day/phase, collected
 * keywords, inventory, dialogue progress, open windows) into a short binary
 * blob, base64url-encodes it, and writes it to `location.search` so a save
 * is just "the current URL". Loading reverses the process.
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
 *   [3-6]    energy, mental, physical, satiety (0-255 each)
 *   [7]      open-windows bitmask (bit per WINDOW_APP_IDS entry)
 *   [8]      HIS actor index + 1 (0 = none)
 *   [9]      HIS dialogue node index + 1 (0 = none / not started)
 *   [10]     Social actor index + 1 (0 = none)
 *   [11]     Social dialogue node index + 1 (0 = none / not started)
 *   [12]     collected-keyword count (0-255)
 *   [13..]   per keyword: 2-byte keyword index + 1-byte collectedDay
 *   [next]   inventory-entry count (0-255)
 *   [...]    per item: 2-byte item index + 1-byte held count
 */
class SaveManager {
  constructor() {
    this.hisActors = [];
    this.socialActors = [];
    this.itemIds = [];
    this.keywordIds = [];
    this._launchers = {};
    this._initialized = false;
  }

  /** Preload every data file needed to build the canonical index tables. */
  async init() {
    if (this._initialized) return;
    const [hisData, socialData, itemsData] = await Promise.all([
      dataLoader.loadJSON("his_schedule.json"),
      dataLoader.loadJSON("social_schedule.json"),
      dataLoader.loadJSON("items.json"),
    ]);

    this.hisActors = this._buildActorIndex(hisData.schedule, "patients");
    this.socialActors = this._buildActorIndex(socialData.schedule, "contacts");
    this.itemIds = (itemsData.items || []).map((it) => it.id);

    const keywordDefs = [];
    const seen = new Set();
    const collectFrom = (list, prefix) => {
      (list || []).forEach((actor) => {
        (actor.keywords || []).forEach((k) => {
          if (seen.has(k.id)) return;
          seen.add(k.id);
          keywordDefs.push({ ...k, source: `${prefix}${actor.name}` });
        });
      });
    };
    (hisData.schedule || []).forEach((entry) => collectFrom(entry.patients, "病人-"));
    (socialData.schedule || []).forEach((entry) => collectFrom(entry.contacts, "室友-"));
    (itemsData.items || []).forEach((item) => {
      (item.revealKeywords || []).forEach((k) => {
        if (seen.has(k.id)) return;
        seen.add(k.id);
        keywordDefs.push({ ...k, source: `物品-${item.name}` });
      });
    });
    // Register every known keyword definition up-front so a restored save
    // can resolve any previously-collected keyword id, even if the HIS/Social
    // schedule entry it originally came from isn't the currently active one.
    keywordManager.registerDefinitions(keywordDefs);
    this.keywordIds = keywordDefs.map((k) => k.id);

    this._initialized = true;
  }

  _buildActorIndex(schedule, listKey) {
    const actors = [];
    const seen = new Set();
    (schedule || []).forEach((entry) => {
      (entry[listKey] || []).forEach((actor) => {
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
  loadFromString(str) {
    try {
      const bytes = base64UrlDecode(str);
      this._decode(bytes);
      window.history.replaceState(null, "", `${window.location.pathname}?${str}`);
      return true;
    } catch (err) {
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
    const bytes = [];
    bytes.push(SAVE_FORMAT_VERSION);
    bytes.push(clampByte(gameState.day));
    bytes.push(gameState.phase === "night" ? 1 : 0);
    bytes.push(clampByte(gameState.energy));
    bytes.push(clampByte(gameState.mental));
    bytes.push(clampByte(gameState.physical));
    bytes.push(clampByte(gameState.satiety));

    const openIds = new Set(windowManager.openAppIds());
    let windowMask = 0;
    WINDOW_APP_IDS.forEach((id, idx) => {
      if (openIds.has(id)) windowMask |= 1 << idx;
    });
    bytes.push(windowMask);

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

    return Uint8Array.from(bytes);
  }

  _decode(bytes) {
    let i = 0;
    i += 1; // format version - reserved for future migrations
    const day = bytes[i++];
    const phase = bytes[i++] === 1 ? "night" : "day";
    const energy = bytes[i++];
    const mental = bytes[i++];
    const physical = bytes[i++];
    const satiety = bytes[i++];
    const windowMask = bytes[i++];
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

    gameState.restore({ day, phase, energy, mental, physical, satiety });
    keywordManager.restoreCollected(keywordEntries);
    itemManager.restoreInventory(itemEntries);

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

    WINDOW_APP_IDS.forEach((id, idx) => {
      const shouldOpen = (windowMask & (1 << idx)) !== 0;
      const isOpen = !!windowManager.getByAppId(id);
      if (shouldOpen && !isOpen && this._launchers[id]) {
        this._launchers[id]();
      } else if (!shouldOpen && isOpen) {
        windowManager.closeByAppId(id);
      }
    });
  }
}

export const saveManager = new SaveManager();
export default SaveManager;
