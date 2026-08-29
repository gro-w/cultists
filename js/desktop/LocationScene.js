import { locationSystem } from "../core/LocationSystem.js";
import { itemManager } from "../core/ItemManager.js";
import { itemPlacementManager } from "../core/ItemPlacementManager.js";
import { eventBus } from "../core/EventBus.js";
import { renderInspectResult } from "../core/InspectFormat.js";
import { gameState } from "../core/GameState.js";

/**
 * LocationScene — full-screen location overlay for non-dorm locations:
 *   hospital, restaurant, seaside, or any future location.
 *
 * Mounting:
 *   const scene = new LocationScene(containerEl);
 *   await scene.show("hospital");   // loads location data and renders
 *   scene.hide();
 *
 * The container element should already be in the DOM and positioned
 * fixed/absolute (it is the `.location-scene-overlay` layer in index.html).
 */
export default class LocationScene {
  constructor(container) {
    this._container = container;
    this._locationId = null;
    this._offItems = null;
    this._build();
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────
  _build() {
    this._container.className = "location-scene-overlay hidden";
    this._container.innerHTML = `
      <div class="loc-scene-root">
        <div class="loc-scene-bg-wrap">
          <img class="loc-scene-bg" alt="" />
          <div class="loc-scene-item-layer"></div>
        </div>
        <div class="loc-scene-header">
          <strong class="loc-scene-title"></strong>
          <button type="button" class="win95-btn bevel-out loc-scene-back">← 返回</button>
        </div>
        <div class="loc-scene-interaction panel-inset">
          <p class="loc-scene-hint">点击场景中的物品进行交互。</p>
        </div>
      </div>`;

    this._bgEl          = this._container.querySelector(".loc-scene-bg");
    this._itemLayer     = this._container.querySelector(".loc-scene-item-layer");
    this._titleEl       = this._container.querySelector(".loc-scene-title");
    this._interactionEl = this._container.querySelector(".loc-scene-interaction");
    this._container.querySelector(".loc-scene-back")
      .addEventListener("click", () => this.hide());
  }

  // ── helpers ───────────────────────────────────────────────────────────────────
  _applySanityBg() {
    if (!this._locationId) return;
    const san = gameState.mental ?? 100;
    const img = locationSystem.resolveBackground(this._locationId, san);
    if (img) {
      this._bgEl.src = img;
      this._bgEl.hidden = false;
    } else {
      this._bgEl.hidden = true;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  async show(locationId) {
    await locationSystem.load();
    const loc = locationSystem.get(locationId);
    if (!loc) {
      console.warn(`[LocationScene] Unknown location: ${locationId}`);
      return;
    }

    this._locationId = locationId;
    this._titleEl.textContent = loc.name;
    this._applySanityBg();

    this._container.classList.remove("hidden");
    this._renderItems(loc);

    // Re-render when items change (pick up / use)
    if (this._offItems) this._offItems();
    this._offItems = eventBus.on("items:changed", () => this._renderItems(loc));
    if (this._offPlacements) this._offPlacements();
    this._offPlacements = eventBus.on("item-placements:changed", () => this._renderItems(loc));

    // Swap background when sanity changes while scene is open
    if (this._offSan) this._offSan();
    this._offSan = eventBus.on("game:sanity_changed", () => this._applySanityBg());
  }

  hide() {
    this._container.classList.add("hidden");
    this._locationId = null;
    if (this._offItems)      { this._offItems();      this._offItems      = null; }
    if (this._offPlacements) { this._offPlacements(); this._offPlacements = null; }
    if (this._offSan)        { this._offSan();        this._offSan        = null; }
  }

  // ── Item rendering ───────────────────────────────────────────────────────────
  _renderItems(loc) {
    this._itemLayer.innerHTML = "";

    // Items with explicit x/y get position:absolute directly in the layer.
    // Items without coordinates go into a flex bar at the bottom so they
    // don't all pile up at (0,0).
    const floatBar = document.createElement("div");
    floatBar.className = "loc-item-float-bar";
    this._itemLayer.appendChild(floatBar);

    const place = (btn) => {
      if (btn.dataset.positioned) {
        this._itemLayer.appendChild(btn);
      } else {
        floatBar.appendChild(btn);
      }
    };

    const layer = loc.layer || "above";

    // ── Source 1: ItemPlacementManager (condition-gated) ────────────────────
    itemPlacementManager.visibleFor(loc.id).forEach((placement) => {
      if (placement.layer === "below") return;
      const def = itemManager.getDef(placement.itemId);
      const hotspot = placement.hotspot || {};
      place(this._makeItemBtn({
        icon: hotspot.icon || "❔",
        label: hotspot.label || def?.name || placement.itemId,
        x: hotspot.x, y: hotspot.y,
        onClick: () => this._inspectPlacement(placement.id),
      }));
    });

    // ── Source 2: items.json locations field ────────────────────────────────
    itemManager.worldItemsAt(loc.id).forEach((def) => {
      if ((def.layer || layer) === "below") return;
      place(this._makeItemBtn({
        icon: def.icon || "📦",
        label: def.name || def.id,
        x: def.sceneX, y: def.sceneY,
        onClick: () => this._inspectWorldItem(def.id),
      }));
    });

    // ── Source 3: loc.hotspots (dev-placed character/item markers) ───────────
    (loc.hotspots || []).forEach((h) => {
      if (!h.targetId) return;
      const def = itemManager.getDef(h.targetId);
      place(this._makeItemBtn({
        icon: h.icon || def?.icon || "👤",
        label: h.label || def?.name || h.targetId,
        x: h.x, y: h.y,
        onClick: () => def ? this._inspectWorldItem(h.targetId) : this._message(`（${h.label || h.targetId}）`),
      }));
    });
  }

  /** Make a positioned item button. If x/y absent, floats in the float bar. */
  _makeItemBtn({ icon, label, x, y, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn bevel-out loc-item-btn";
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    if (x != null && y != null) {
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
      btn.dataset.positioned = "1"; // tells _renderItems to append directly to layer
    }
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ── Item interaction ─────────────────────────────────────────────────────────
  _inspectPlacement(placementId) {
    const inspected = itemPlacementManager.inspect(placementId);
    if (!inspected.ok) { this._message(inspected.message); return; }
    const def = itemManager.getDef(inspected.placement.itemId);
    this._showItemPanel(def, inspected.result, {
      canTake: def?.pickable !== false,
      onTake: () => {
        const r = itemPlacementManager.take(placementId);
        this._message(r.message, r.ok ? "success" : "");
        if (r.ok) this._renderItems(locationSystem.get(this._locationId));
      },
    });
  }

  _inspectWorldItem(itemId) {
    const def = itemManager.getDef(itemId);
    if (!def) return;
    const result = itemManager.inspect(itemId);
    this._showItemPanel(def, result, {
      canTake: def.pickable === true,
      onTake: def.pickable ? () => {
        itemManager.add(itemId, 1);
        this._message(`你拿起了${def.name}。`, "success");
        this._renderItems(locationSystem.get(this._locationId));
      } : null,
    });
  }

  _showItemPanel(def, result, { canTake, onTake } = {}) {
    this._interactionEl.innerHTML = "";

    const h = document.createElement("h3");
    h.textContent = def?.name || "物品";
    this._interactionEl.appendChild(h);

    const resultEl = document.createElement("div");
    this._interactionEl.appendChild(resultEl);
    renderInspectResult(result, resultEl);

    const img = itemManager.getImage(def?.id);
    if (img) {
      const imgEl = document.createElement("img");
      imgEl.className = "item-image-preview";
      imgEl.src = img;
      imgEl.alt = def?.name || "";
      this._interactionEl.appendChild(imgEl);
    }

    if (def?.usable) {
      const useBtn = document.createElement("button");
      useBtn.className = "win95-btn bevel-out";
      useBtn.textContent = "使用";
      useBtn.addEventListener("click", () => {
        const r = itemManager.use(def.id);
        this._message(r.message, r.ok ? "success" : "");
      });
      this._interactionEl.appendChild(useBtn);
    }

    if (canTake && onTake) {
      const takeBtn = document.createElement("button");
      takeBtn.className = "win95-btn bevel-out";
      takeBtn.textContent = "拿起并放入物品栏";
      takeBtn.addEventListener("click", onTake);
      this._interactionEl.appendChild(takeBtn);
    }
  }

  _message(text, className = "") {
    this._interactionEl.className = "loc-scene-interaction panel-inset";
    this._interactionEl.textContent = text;
    if (className) this._interactionEl.classList.add(className);
  }
}
