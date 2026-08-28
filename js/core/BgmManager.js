import { eventBus } from "./EventBus.js";
import { settingsManager } from "./SettingsManager.js";
import { gameState } from "./GameState.js";
import { dataLoader } from "./DataLoader.js";

const FADE_MS = 400;

/**
 * BgmManager — unified BGM playback controller for 《完蛋，我被邪教徒包围了！》.
 *
 * Priority (highest wins):
 *   4  ending    — set when ending:triggered fires and the ending def carries bgmId
 *   3  dialogue  — pushed/popped via onShow.bgm { action, bgmId }
 *   2  schedule  — best-matching defaultRule for current day + phase
 *   1  (none)    — fallback: "stop" | "continue" per bgm.json
 *
 * A single <audio> element is reused.  Switching fades: old → silence → new.
 *
 * Track schema (bgm.json):
 * {
 *   "tracks": [
 *     { "id": "bgm_day", "name": "白天主题", "src": "audio/bgm_day.ogg", "note": "" }
 *   ],
 *   "defaultRules": [
 *     { "id": "rule_1", "dayMin": 1, "dayMax": 7, "phase": "day",
 *       "bgmId": "bgm_day", "priority": 0 }
 *   ],
 *   "fallback": "stop"
 * }
 *
 * defaultRule fields:
 *   dayMin / dayMax  — null or absent = any day
 *   phase            — "day" | "night" | null = any phase
 *   sanMin / sanMax  — 0–100; null or absent = any sanity (thresholds: 90/70/50/30/15)
 *   priority         — integer, higher number wins when multiple rules match
 *
 * onShow.bgm in dialogue nodes:
 *   { "action": "play",    "bgmId": "bgm_investigation" }  — push onto dialogue stack
 *   { "action": "restore"                                 }  — pop dialogue stack
 *   { "action": "stop"                                    }  — push null (silence)
 */
class BgmManager {
  constructor() {
    /** @type {Map<string, {id:string, name:string, src:string, note?:string}>} */
    this.tracks = new Map();
    /** @type {Array<object>} */
    this.defaultRules = [];
    /** @type {"stop"|"continue"} */
    this.fallback = "stop";

    this._audio = null;
    this._currentTrackId = null; // id of the track currently loaded into _audio
    this._fadingOut = false;
    this._pending = undefined;   // track id queued while fade-out is in progress

    // Priority layer state
    this._endingBgmId = null;   // layer 4
    this._dialogueStack = [];   // layer 3 — stack of (string | null)

    this._loadPromise = null;
    this._mounted = false;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  /** Mount the hidden <audio> element and subscribe to engine events. Call once at boot. */
  mount() {
    if (this._mounted) return;
    this._mounted = true;

    const el = document.createElement("audio");
    el.loop = true;
    el.volume = settingsManager.bgmVolume / 100;
    document.body.appendChild(el);
    this._audio = el;

    // Volume mirrors settings at all times
    settingsManager.onChange(({ bgmVolume }) => {
      if (this._audio && !this._fadingOut) {
        this._audio.volume = bgmVolume / 100;
      }
    });

    // Schedule layer: re-evaluate whenever day or phase changes
    eventBus.on("gamestate:changed", () => this._resolveAndPlay());
    eventBus.on("daynight:changed",  () => this._resolveAndPlay());

    // Ending layer: highest priority, never released within a run
    eventBus.on("ending:triggered", (def) => {
      if (def && def.bgmId) {
        this._endingBgmId = def.bgmId;
        this._resolveAndPlay();
      }
    });
  }

  /** Load bgm.json (idempotent; missing file is non-fatal). */
  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("bgm.json").then((data) => {
        this.tracks = new Map((data.tracks || []).map((t) => [t.id, t]));
        this.defaultRules = data.defaultRules || [];
        this.fallback = data.fallback || "stop";
        // Apply initial BGM after data is available
        this._resolveAndPlay();
      }).catch((err) => {
        // bgm.json absent is not fatal — the game works without BGM
        console.info("[BgmManager] bgm.json not available:", err.message);
      });
    }
    return this._loadPromise;
  }

  // ── Dialogue layer (called from DialogueEffects) ──────────────────────────

  /**
   * Push a BGM command from a dialogue node's onShow.bgm.
   * @param {"play"|"restore"|"stop"} action
   * @param {string|null} bgmId — only used when action === "play"
   */
  applyDialogueBgm(action, bgmId) {
    if (action === "restore") {
      if (this._dialogueStack.length) this._dialogueStack.pop();
    } else if (action === "stop") {
      this._dialogueStack.push(null);
    } else {
      // "play" or unknown — treat as play
      this._dialogueStack.push(bgmId || null);
    }
    this._resolveAndPlay();
  }

  /** Remove the last dialogue BGM push (e.g. when leaving a dialogue). */
  popDialogueBgm() {
    if (this._dialogueStack.length) this._dialogueStack.pop();
    this._resolveAndPlay();
  }

  /** Clear entire dialogue stack (e.g. when a dialogue window closes). */
  clearDialogueBgm() {
    if (!this._dialogueStack.length) return;
    this._dialogueStack = [];
    this._resolveAndPlay();
  }

  // ── Priority resolution ───────────────────────────────────────────────────

  /**
   * Return the track id that should be playing right now.
   * Returns null to mean "silence".
   */
  resolve() {
    // Layer 4: ending BGM (never released)
    if (this._endingBgmId) return this._endingBgmId;

    // Layer 3: top of dialogue stack (undefined means "no dialogue rule active")
    if (this._dialogueStack.length > 0) {
      return this._dialogueStack[this._dialogueStack.length - 1]; // may be null → silence
    }

    // Layer 2: best-matching default rule
    const ruleTrack = this._matchDefaultRule();
    if (ruleTrack !== null) return ruleTrack;

    // Layer 1: fallback
    if (this.fallback === "continue") return this._currentTrackId;
    return null; // stop
  }

  _matchDefaultRule() {
    const { day, phase } = gameState;
    const san = gameState.mental ?? 100;
    const candidates = this.defaultRules.filter((r) => {
      if (r.dayMin != null && day < Number(r.dayMin)) return false;
      if (r.dayMax != null && day > Number(r.dayMax)) return false;
      if (r.phase  != null && r.phase !== phase) return false;
      if (r.sanMin != null && san < Number(r.sanMin)) return false;
      if (r.sanMax != null && san > Number(r.sanMax)) return false;
      return Boolean(r.bgmId);
    });
    if (!candidates.length) return null;
    // Higher priority number wins; tie → first in array (stable)
    candidates.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    return candidates[0].bgmId;
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  _resolveAndPlay() {
    this._playTrack(this.resolve());
  }

  /**
   * Switch to trackId (null = silence).
   * Fades out the current track then fades in the new one.
   */
  _playTrack(trackId) {
    // Validate: unknown ID → warn and treat as stop
    if (trackId != null && !this.tracks.has(trackId)) {
      console.warn(`[BgmManager] Unknown track id "${trackId}" — stopping BGM.`);
      trackId = null;
    }

    // Already playing the right thing
    if (trackId === this._currentTrackId) return;

    if (this._fadingOut) {
      // A fade-out is already in progress; update the queued next track
      this._pending = trackId;
      return;
    }

    if (!this._audio) return;

    const doSwitch = (id) => {
      this._fadingOut = false;
      this._pending = undefined;
      this._currentTrackId = id;

      if (!id) {
        this._audio.pause();
        this._audio.removeAttribute("src");
        return;
      }
      const track = this.tracks.get(id);
      if (!track || !track.src) {
        console.warn(`[BgmManager] Track "${id}" has no src.`);
        return;
      }
      this._audio.src = track.src;
      this._audio.load();
      this._audio.volume = 0;
      this._audio.play().catch(() => {
        // Browser autoplay policy — will play after first user gesture
      });
      this._fadeIn();
    };

    const isPlaying = !this._audio.paused && this._audio.src;
    if (isPlaying) {
      this._fadingOut = true;
      this._pending = trackId;
      this._fadeTo(0, FADE_MS, () => {
        const next = this._pending !== undefined ? this._pending : trackId;
        doSwitch(next);
      });
    } else {
      doSwitch(trackId);
    }
  }

  _fadeIn() {
    const target = Math.min(1, settingsManager.bgmVolume / 100);
    this._fadeTo(target, FADE_MS);
  }

  _fadeTo(targetVolume, durationMs, onDone) {
    if (!this._audio) { if (onDone) onDone(); return; }
    const start = this._audio.volume;
    const delta = targetVolume - start;
    if (Math.abs(delta) < 0.001) {
      this._audio.volume = targetVolume;
      if (onDone) onDone();
      return;
    }
    const startTime = performance.now();
    const tick = (now) => {
      if (!this._audio) { if (onDone) onDone(); return; }
      const t = Math.min(1, (now - startTime) / durationMs);
      this._audio.volume = Math.max(0, Math.min(1, start + delta * t));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        if (onDone) onDone();
      }
    };
    requestAnimationFrame(tick);
  }

  // ── Dev/editor helpers ───────────────────────────────────────────────────

  /** Immediately play a track for preview (bypasses priority resolution). */
  previewTrack(trackId) {
    if (!this._audio) return;
    if (!trackId) { this.stopPreview(); return; }
    const track = this.tracks.get(trackId);
    if (!track || !track.src) return;
    this._audio.src = track.src;
    this._audio.load();
    this._audio.volume = settingsManager.bgmVolume / 100;
    this._audio.play().catch(() => {});
  }

  stopPreview() {
    if (!this._audio) return;
    this._audio.pause();
    this._audio.removeAttribute("src");
  }

  /** Return all tracks as an array (for UI). */
  allTracks() { return [...this.tracks.values()]; }

  /**
   * Hot-replace track + rule data from the BGM editor without reloading the page.
   * Also re-evaluates the current BGM.
   */
  replaceData({ tracks, defaultRules, fallback }) {
    this.tracks = new Map((tracks || []).map((t) => [t.id, t]));
    this.defaultRules = defaultRules || [];
    this.fallback = fallback || "stop";
    this._loadPromise = Promise.resolve(); // mark as loaded
    this._resolveAndPlay();
  }

  /**
   * Scan a dialogueTree for onShow.bgm references.
   * @returns {Array<{nodeId:string, bgmId:string, action:string}>}
   */
  static scanDialogueTree(tree) {
    const refs = [];
    Object.entries(tree?.nodes || {}).forEach(([nodeId, node]) => {
      const bgm = node?.onShow?.bgm;
      if (bgm && bgm.bgmId) {
        refs.push({ nodeId, bgmId: bgm.bgmId, action: bgm.action || "play" });
      }
    });
    return refs;
  }
}

export const bgmManager = new BgmManager();
export default BgmManager;
