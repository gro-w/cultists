import { settingsManager } from "./SettingsManager.js";

/**
 * AudioManager - thin wrapper around a single background-music `<audio>`
 * element. No BGM asset ships with this demo build, but the element and
 * volume wiring are fully functional so a track can be dropped in later
 * (see `setTrack`). Volume always mirrors `SettingsManager.bgmVolume`.
 */
class AudioManager {
  constructor() {
    this.bgmEl = document.createElement("audio");
    this.bgmEl.loop = true;
    this.bgmEl.volume = settingsManager.bgmVolume / 100;
    settingsManager.onChange(({ bgmVolume }) => {
      this.bgmEl.volume = bgmVolume / 100;
    });
  }

  /** Mount the hidden audio element into the document (call once at boot). */
  mount() {
    document.body.appendChild(this.bgmEl);
  }

  /** Set (or replace) the current BGM track URL and start playing it. */
  setTrack(src) {
    this.bgmEl.src = src;
    this.bgmEl.play().catch(() => {
      // Autoplay may be blocked until the user interacts with the page;
      // this is expected and safely ignored.
    });
  }
}

export const audioManager = new AudioManager();
export default AudioManager;
