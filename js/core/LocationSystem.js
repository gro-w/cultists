import { dataLoader } from "./DataLoader.js";
import { eventBus } from "./EventBus.js";

/**
 * LocationSystem — owns location definitions loaded from `data/<lang>/locations.json`.
 *
 * Location shape:
 *   {
 *     id: string,
 *     name: string,
 *     backgroundImage: string,   // relative asset path
 *     layer: "above" | "below",  // item layer default
 *     subLocations: [{ id, name, zone: { x, y, width, height } }]
 *   }
 *
 * Item location keys:
 *   "locationId"            — top-level; appears anywhere in that scene
 *   "locationId/subId"      — sub-location; positioned inside sub-zone
 */
class LocationSystem {
  constructor() {
    /** @type {Array} */
    this.locations = [];
    /** @type {Map<string, object>} */
    this._byId = new Map();
    this._loadPromise = null;
  }

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("locations.json").then((data) => {
        this.locations = data.locations || [];
        this._index();
      });
    }
    return this._loadPromise;
  }

  _index() {
    this._byId = new Map(this.locations.map((loc) => [loc.id, loc]));
  }

  /** @returns {object|null} */
  get(id) {
    return this._byId.get(id) || null;
  }

  /** @returns {object|null} */
  getSubLocation(locationId, subId) {
    const loc = this.get(locationId);
    if (!loc) return null;
    return (loc.subLocations || []).find((s) => s.id === subId) || null;
  }

  all() {
    return [...this.locations];
  }

  /**
   * Return all location keys (flat + nested) for building a picker dropdown.
   * e.g. ["dorm", "dorm/player_desk", "dorm/ajie_desk", "hospital", ...]
   */
  allKeys() {
    const keys = [];
    this.locations.forEach((loc) => {
      keys.push({ key: loc.id, label: loc.name });
      (loc.subLocations || []).forEach((sub) => {
        keys.push({ key: `${loc.id}/${sub.id}`, label: `${loc.name} / ${sub.name}` });
      });
    });
    return keys;
  }

  /**
   * Resolve the background image for a location given the current sanity value.
   * backgroundImages: [{ sanMin: number|null, sanMax: number|null, image: string }]
   * Returns the image path of the first matching band, or "" if none match.
   * Falls back to the legacy `backgroundImage` field for old data.
   */
  resolveBackground(locationId, sanity = 100) {
    const loc = this.get(locationId);
    if (!loc) return "";
    // legacy single-image
    if (!loc.backgroundImages || loc.backgroundImages.length === 0) {
      return loc.backgroundImage || "";
    }
    for (const band of loc.backgroundImages) {
      const lo = band.sanMin ?? -Infinity;
      const hi = band.sanMax ?? Infinity;
      if (sanity >= lo && sanity <= hi) return band.image || "";
    }
    // no band matched — return the last entry as default
    return loc.backgroundImages[loc.backgroundImages.length - 1]?.image || "";
  }

  /** Update a location definition in memory (dev editor). */
  update(locationDef) {
    const idx = this.locations.findIndex((l) => l.id === locationDef.id);
    if (idx >= 0) this.locations[idx] = locationDef;
    else this.locations.push(locationDef);
    this._index();
    eventBus.emit("locations:changed");
  }

  snapshot() {
    return { locations: this.locations };
  }
}

export const locationSystem = new LocationSystem();
export default LocationSystem;
