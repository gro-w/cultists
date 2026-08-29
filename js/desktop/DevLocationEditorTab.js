// DEV-TOOLS:START
import { dataLoader, writeJSONToDisk } from "../core/DataLoader.js";
import { locationSystem } from "../core/LocationSystem.js";

/**
 * DevLocationEditorTab — edit location definitions AND item placements.
 *
 * Canvas modes:
 *   zone      – drag to define sub-location zone rectangles
 *   hotspot   – click/drag to place scene hotspots (loc.hotspots[])
 *   placement – select a placement from the list, click canvas to set x/y
 *
 * Item placements are loaded from / saved to `item_placements.json`.
 * Only placements whose `location` field matches the currently-selected
 * location ID are shown here.
 *
 * Inline onclick= handlers reference window._le (set to `this` on mount).
 */
export class DevLocationEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    this._root = null;
    /** @type {Array} locations.json */
    this._locations = [];
    /** @type {Array} item_placements.json full list */
    this._allPlacements = [];
    this._currentId = null;
    this._dirty = false;
    this._placementsDirty = false;
    // canvas drag state
    this._dragging = false;
    this._dragSubId = null;
    this._dragStart = null;
    this._dragHotspot = null;
    this._dragPlacement = null;
    // placement canvas selection
    this._activePlacementId = null;
    // cached bg image for canvas redraws
    this._bgImage = null;
    this._bgImageSrc = null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  _el(id) { return this._root?.querySelector(`#${CSS.escape(id)}`) || null; }
  _e(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  _imageSrc(value) {
    const path = typeof value === "string" ? value.trim() : "";
    if (!path) return "";
    try { return new URL(path, document.baseURI).href; } catch (_) { return path; }
  }
  _st(s) { this._dev.setStatus(s); }
  /** Placements belonging to the current location */
  _locPlacements() {
    return this._allPlacements.filter((p) => p.location === this._currentId);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  mount(root = null) {
    this._root = root || this._dev.root.querySelector(".dev-le-root");
    if (!this._root) { this._st("位置编辑器挂载失败：找不到编辑器根节点。", true); return; }
    window._le = this;
    this._root?.addEventListener("pointerdown", () => { window._le = this; });
    this._loadData().catch((err) => this._st(`读取位置数据失败：${err.message}`, true));
  }

  unmount() {
    if (window._le === this) window._le = null;
  }

  // ── HTML ───────────────────────────────────────────────────────────────────
  html() {
    return `<div class="dev-le-root">
<div class="dev-le-toolbar dev-ie-toolbar">
  <strong style="font-size:13px">位置编辑器</strong>
  <button type="button" class="win95-btn dev-btn" onclick="_le._loadData()">⬇ 从磁盘读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_le.exportJSON()">📤 导出 JSON</button>
  <button type="button" class="win95-btn dev-btn" onclick="_le.writeToDisk()">💽 写入磁盘</button>
</div>
<div class="dev-le-main">
  <aside class="dev-ie-sidebar">
    <div class="dev-ie-sidebar-hd">
      <span style="font-size:12px;color:#888">位置列表</span>
      <button type="button" class="win95-btn dev-btn" onclick="_le._addLocation()">＋</button>
    </div>
    <div id="le-loc-list" class="dev-ie-item-list"></div>
  </aside>
  <section id="le-editor" class="dev-ie-editor">
    <div id="le-editor-empty" style="color:#aaa;padding:40px;text-align:center">← 选择位置或点击 ＋ 新建</div>
    <div id="le-editor-form" style="display:none;padding:10px;overflow:auto">

      <div class="dev-section dev-ie-sec"><h3>📍 基本信息</h3>
        <div class="dev-ie-row">
          <div class="dev-ie-field"><label>位置 ID</label><input type="text" id="le-f-id" oninput="_le._setDirty()"></div>
          <div class="dev-ie-field"><label>名称</label><input type="text" id="le-f-name" oninput="_le._setDirty()"></div>
          <div class="dev-ie-field" style="flex:0">
            <label>物品图层</label>
            <select id="le-f-layer" onchange="_le._setDirty()">
              <option value="above">前景（可点击）</option>
              <option value="below">背景（装饰）</option>
            </select>
          </div>
        </div>
        <div class="dev-ie-field" style="flex-direction:column">
          <label>背景图片（按理智值区间）</label>
          <p style="font-size:11px;color:#888;margin:0 0 4px">每行对应一个理智值区间，进入场景时自动显示匹配的背景图。留空则任意理智值匹配。</p>
          <table class="dev-table" style="font-size:11px;width:100%">
            <thead><tr><th>理智 ≥</th><th>理智 ≤</th><th>预览</th><th>操作</th></tr></thead>
            <tbody id="le-bg-list"></tbody>
          </table>
          <button type="button" class="win95-btn dev-btn" style="margin-top:6px" onclick="_le._addBgBand()">＋ 添加背景图</button>
        </div>
      </div>

      <div class="dev-section dev-ie-sec"><h3>🗂 子位置</h3>
        <p style="font-size:11px;color:#888;margin:0 0 6px">子位置用于宿舍。其他位置无需添加。每条记录保存一个区域坐标（x/y/width/height），对应背景图上的区域。</p>
        <table class="dev-table" style="font-size:12px">
          <thead><tr><th>子位置 ID</th><th>名称</th><th>x</th><th>y</th><th>width</th><th>height</th><th>删除</th></tr></thead>
          <tbody id="le-sub-tbody"></tbody>
        </table>
        <button type="button" class="win95-btn dev-btn" style="margin-top:6px" onclick="_le._addSub()">＋ 添加子位置</button>
      </div>

      <div class="dev-section dev-ie-sec" id="le-zone-section"><h3>🖼 画布编辑器</h3>
        <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px">模式：</label>
          <select id="le-canvas-mode" onchange="_le._onCanvasModeChange()" style="min-height:22px;border:2px inset #eee;padding:1px 4px;font-size:12px">
            <option value="zone">子位置区域（拖拽绘制）</option>
            <option value="hotspot">物品/立绘位置（点击定位）</option>
            <option value="placement">物品摆放（点击定位）</option>
          </select>
          <span id="le-zone-sub-wrap" style="display:flex;gap:4px;align-items:center">
            <label style="font-size:12px">编辑子位置：</label>
            <select id="le-zone-sub-select" onchange="_le._onZoneSubChange()" style="min-height:22px;border:2px inset #eee;padding:1px 4px;font-size:12px"></select>
          </span>
          <span id="le-placement-pick-wrap" style="display:none;gap:4px;align-items:center">
            <label style="font-size:12px">选中摆放项：</label>
            <select id="le-placement-pick" onchange="_le._onActivePlacementChange()" style="min-height:22px;border:2px inset #eee;padding:1px 4px;font-size:12px"></select>
          </span>
        </div>
        <canvas id="le-zone-canvas" style="border:2px inset #ccc;cursor:crosshair;max-width:100%;background:#111"></canvas>
        <p id="le-zone-hint" style="font-size:11px;color:#888;margin-top:4px"></p>

        <div id="le-hotspot-section" style="display:none;margin-top:8px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <strong style="font-size:12px">Hotspot 列表</strong>
            <span style="font-size:11px;color:#888">点击画布添加；拖动已有标记调整位置</span>
            <button type="button" class="win95-btn dev-btn" onclick="_le._addHotspot()">＋ 手动添加</button>
          </div>
          <table class="dev-table" style="font-size:11px;width:100%">
            <thead><tr><th>物品 / 角色 ID</th><th>标签</th><th>图标</th><th>X</th><th>Y</th><th>删除</th></tr></thead>
            <tbody id="le-hotspot-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- ─── Item Placements ─────────────────────────────────────────────── -->
      <div class="dev-section dev-ie-sec" id="le-placements-section">
        <h3>📦 物品摆放（item_placements.json）</h3>
        <p style="font-size:11px;color:#888;margin:0 0 6px">
          仅显示 <code>location</code> = 当前位置 ID 的条目。
          切换到「物品摆放」画布模式后，选中某项并点击画布即可设置屏幕坐标。
        </p>
        <button type="button" class="win95-btn dev-btn" style="margin-bottom:6px" onclick="_le._addPlacement()">＋ 添加摆放项</button>
        <div id="le-placements-list"></div>
      </div>

      <div style="display:flex;gap:8px;padding:8px 0 4px">
        <button type="button" class="win95-btn dev-btn" onclick="_le._saveLocation()">💾 保存</button>
        <button type="button" class="win95-btn dev-btn" onclick="_le._deleteLocation()">🗑 删除</button>
        <span id="le-save-msg" style="font-size:12px;color:#388e3c;margin-left:8px"></span>
      </div>
    </div>
  </section>
</div>
</div>`;
  }

  // ── data loading ────────────────────────────────────────────────────────────
  async _loadData() {
    try {
      const [locData, placData] = await Promise.all([
        dataLoader.loadJSON("locations.json"),
        dataLoader.loadJSON("item_placements.json"),
      ]);
      this._locations = JSON.parse(JSON.stringify(locData.locations || []));
      this._allPlacements = JSON.parse(JSON.stringify(placData.placements || []));
      this._currentId = null;
      this._dirty = false;
      this._placementsDirty = false;
      this._bgImage = null;
      this._bgImageSrc = null;
      this._renderList();
      this._st(`已读取：${this._locations.length} 个位置，${this._allPlacements.length} 条摆放`);
    } catch (err) {
      this._st(`读取失败：${err.message}`);
    }
  }

  // ── list ────────────────────────────────────────────────────────────────────
  _renderList() {
    const el = this._el("le-loc-list");
    if (!el) return;
    el.innerHTML = this._locations.map((loc) => `
      <div class="dev-ie-item-row${loc.id === this._currentId ? " active" : ""}"
           onclick="_le._selectLocation('${this._e(loc.id)}')">
        <div style="flex:1;overflow:hidden">
          <div style="font-weight:600">${this._e(loc.name) || "(未命名)"}</div>
          <div style="font-size:10px;color:#888">${this._e(loc.id)}</div>
        </div>
        <div style="font-size:10px;color:#999;margin-left:auto">${(loc.subLocations || []).length > 0 ? `${loc.subLocations.length} 子` : ""}</div>
      </div>`).join("") || '<div style="padding:16px;color:#aaa;text-align:center;font-size:12px">暂无位置</div>';
  }

  _selectLocation(id) {
    if (this._currentId && this._dirty) this._saveLocation(true);
    this._currentId = id;
    this._dirty = false;
    this._bgImage = null;
    this._bgImageSrc = null;
    this._activePlacementId = null;
    this._loadForm();
    this._renderList();
  }

  _addLocation() {
    if (this._currentId && this._dirty) this._saveLocation(true);
    const newLoc = { id: "loc_" + Math.random().toString(36).slice(2, 7), name: "新位置", backgroundImages: [], layer: "above", subLocations: [] };
    this._locations.push(newLoc);
    this._currentId = newLoc.id;
    this._dirty = false;
    this._loadForm();
    this._renderList();
  }

  // ── form ────────────────────────────────────────────────────────────────────
  _loadForm() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    const empty = this._el("le-editor-empty");
    const form  = this._el("le-editor-form");
    if (!loc) { if (empty) empty.style.display = ""; if (form) form.style.display = "none"; return; }
    if (empty) empty.style.display = "none";
    if (form) form.style.display = "";

    const fId   = this._el("le-f-id");   if (fId)  fId.value = loc.id;
    const fName = this._el("le-f-name"); if (fName) fName.value = loc.name;
    const fLayer = this._el("le-f-layer"); if (fLayer) fLayer.value = loc.layer || "above";

    this._renderBgList();
    this._renderSubTable();
    this._updateZoneSection();
    this._renderPlacementsList();
  }

  _setDirty() { this._dirty = true; }
  _setPlacementsDirty() { this._placementsDirty = true; }

  // ── canvas mode ─────────────────────────────────────────────────────────────
  _onCanvasModeChange() {
    const mode = this._el("le-canvas-mode")?.value ?? "zone";
    const zoneWrap     = this._el("le-zone-sub-wrap");
    const hotspotSec   = this._el("le-hotspot-section");
    const placPickWrap = this._el("le-placement-pick-wrap");
    if (zoneWrap)     zoneWrap.style.display     = mode === "zone"      ? "" : "none";
    if (hotspotSec)   hotspotSec.style.display   = mode === "hotspot"   ? "" : "none";
    if (placPickWrap) placPickWrap.style.display  = mode === "placement" ? "flex" : "none";
    if (mode === "hotspot")   this._renderHotspotTable();
    if (mode === "placement") this._refreshPlacementPicker();
    this._redrawZoneCanvas();
    this._updateHint();
  }

  _updateHint() {
    const hint = this._el("le-zone-hint");
    if (!hint) return;
    const mode = this._el("le-canvas-mode")?.value ?? "zone";
    if (mode === "zone") {
      const sel = this._el("le-zone-sub-select");
      hint.textContent = sel?.value
        ? `拖动鼠标在背景图上为「${sel.options[sel.selectedIndex]?.text}」绘制区域矩形。`
        : "请先选择子位置。";
    } else if (mode === "hotspot") {
      hint.textContent = "点击画布空白处添加标记；拖动已有标记调整位置。";
    } else if (mode === "placement") {
      const sel = this._el("le-placement-pick");
      hint.textContent = sel?.value
        ? `点击画布为「${sel.options[sel.selectedIndex]?.text}」设置摆放坐标；拖动已有摆放项移动它。`
        : "请先添加摆放项，或从下拉框选择一项。";
    }
  }

  // ── hotspot editing ──────────────────────────────────────────────────────────
  _renderHotspotTable() {
    const tbody = this._el("le-hotspot-tbody");
    if (!tbody) return;
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    if (!loc.hotspots) loc.hotspots = [];
    tbody.innerHTML = loc.hotspots.map((h, i) => `
      <tr>
        <td><input type="text" value="${this._e(h.targetId || "")}"
          style="width:120px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setHotspotField(${i},'targetId',this.value)"></td>
        <td><input type="text" value="${this._e(h.label || "")}"
          style="width:100px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setHotspotField(${i},'label',this.value)"></td>
        <td><input type="text" value="${this._e(h.icon || "")}"
          style="width:40px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px;text-align:center"
          onchange="_le._setHotspotField(${i},'icon',this.value)"></td>
        <td><input type="number" value="${h.x ?? 0}"
          style="width:52px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setHotspotField(${i},'x',Number(this.value))"></td>
        <td><input type="number" value="${h.y ?? 0}"
          style="width:52px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setHotspotField(${i},'y',Number(this.value))"></td>
        <td><button type="button" class="win95-btn dev-btn"
          onclick="_le._removeHotspot(${i})">✕</button></td>
      </tr>`).join("") || `<tr><td colspan="6" style="color:#aaa;font-size:11px;padding:4px">暂无 hotspot</td></tr>`;
    this._redrawZoneCanvas();
  }

  _addHotspot() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    if (!loc.hotspots) loc.hotspots = [];
    loc.hotspots.push({ targetId: "", label: "", icon: "❔", x: 100, y: 100 });
    this._dirty = true;
    this._renderHotspotTable();
  }

  _removeHotspot(i) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.hotspots) return;
    loc.hotspots.splice(i, 1);
    this._dirty = true;
    this._renderHotspotTable();
  }

  _setHotspotField(i, field, val) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.hotspots?.[i]) return;
    loc.hotspots[i][field] = val;
    this._dirty = true;
    this._redrawZoneCanvas();
  }

  // ── item placements editing ──────────────────────────────────────────────────
  _renderPlacementsList() {
    const container = this._el("le-placements-list");
    if (!container) return;
    const placements = this._locPlacements();
    if (placements.length === 0) {
      container.innerHTML = '<p style="color:#aaa;font-size:12px">此位置暂无摆放项。</p>';
      this._refreshPlacementPicker();
      return;
    }
    container.innerHTML = placements.map((p) => {
      const pi = this._allPlacements.indexOf(p);
      const hx = p.hotspot?.x ?? "";
      const hy = p.hotspot?.y ?? "";
      return `
<article class="dev-ded-card" style="margin-bottom:8px">
  <div class="dev-ded-card-title">
    <b>${this._e(p.id || "(未命名)")}</b>
    <button type="button" class="win95-btn dev-btn" onclick="_le._removePlacement(${pi})">− 删除</button>
  </div>
  <div class="dev-ie-row" style="flex-wrap:wrap;gap:6px">
    <div class="dev-ie-field" style="min-width:120px">
      <label style="font-size:11px">摆放 ID</label>
      <input type="text" value="${this._e(p.id)}" style="width:140px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementField(${pi},'id',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:120px">
      <label style="font-size:11px">物品 ID</label>
      <input type="text" value="${this._e(p.itemId)}" style="width:140px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementField(${pi},'itemId',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:80px">
      <label style="font-size:11px">区域 ID</label>
      <input type="text" value="${this._e(p.zone || "")}" style="width:100px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementField(${pi},'zone',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:50px">
      <label style="font-size:11px">图标</label>
      <input type="text" value="${this._e(p.hotspot?.icon ?? "")}" style="width:48px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px;text-align:center"
        onchange="_le._setPlacementHotspot(${pi},'icon',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:100px">
      <label style="font-size:11px">标签</label>
      <input type="text" value="${this._e(p.hotspot?.label ?? "")}" style="width:120px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementHotspot(${pi},'label',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:58px">
      <label style="font-size:11px">X 坐标</label>
      <input type="number" value="${hx}" placeholder="—" style="width:64px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementHotspot(${pi},'x',this.value===''?null:Number(this.value))">
    </div>
    <div class="dev-ie-field" style="min-width:58px">
      <label style="font-size:11px">Y 坐标</label>
      <input type="number" value="${hy}" placeholder="—" style="width:64px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementHotspot(${pi},'y',this.value===''?null:Number(this.value))">
    </div>
  </div>
  <div class="dev-ie-row" style="flex-wrap:wrap;gap:6px;margin-top:4px">
    <div class="dev-ie-field" style="min-width:200px;flex:1">
      <label style="font-size:11px">拾取提示</label>
      <input type="text" value="${this._e(p.takeMessage ?? "")}" style="width:100%;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementField(${pi},'takeMessage',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:200px;flex:1">
      <label style="font-size:11px">放回提示</label>
      <input type="text" value="${this._e(p.returnMessage ?? "")}" style="width:100%;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_le._setPlacementField(${pi},'returnMessage',this.value)">
    </div>
    <div class="dev-ie-field" style="min-width:160px">
      <label style="font-size:11px">
        <input type="checkbox" ${p.condition?.roommatesSleeping ? "checked" : ""}
          onchange="_le._setPlacementCondition(${pi},'roommatesSleeping',this.checked)">
        仅室友睡觉时可见
      </label>
    </div>
  </div>
  <div style="margin-top:4px">
    <button type="button" class="win95-btn dev-btn" style="font-size:11px"
      onclick="_le._selectPlacementOnCanvas('${this._e(p.id)}')">🎯 在画布上定位此项</button>
  </div>
</article>`;
    }).join("");
    this._refreshPlacementPicker();
  }

  _refreshPlacementPicker() {
    const sel = this._el("le-placement-pick");
    if (!sel) return;
    const placements = this._locPlacements();
    sel.innerHTML = placements.length === 0
      ? `<option value="">（暂无摆放项）</option>`
      : placements.map((p) =>
          `<option value="${this._e(p.id)}"${p.id === this._activePlacementId ? " selected" : ""}>${this._e(p.id)}</option>`
        ).join("");
    if (!this._activePlacementId && placements.length > 0) {
      this._activePlacementId = placements[0].id;
      sel.value = this._activePlacementId;
    }
    this._updateHint();
    this._redrawZoneCanvas();
  }

  _onActivePlacementChange() {
    const sel = this._el("le-placement-pick");
    this._activePlacementId = sel?.value || null;
    this._updateHint();
    this._redrawZoneCanvas();
  }

  /** Switch to placement canvas mode and highlight the given placement */
  _selectPlacementOnCanvas(placementId) {
    this._activePlacementId = placementId;
    const modeEl = this._el("le-canvas-mode");
    if (modeEl) modeEl.value = "placement";
    this._onCanvasModeChange();
    const sel = this._el("le-placement-pick");
    if (sel) sel.value = placementId;
    this._updateHint();
    this._redrawZoneCanvas();
    const canvas = this._el("le-zone-canvas");
    if (canvas) canvas.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  _addPlacement() {
    const newP = {
      id: `placement_${this._currentId}_${Date.now().toString(36)}`,
      itemId: "",
      location: this._currentId,
      zone: "",
      condition: {},
      hotspot: { icon: "📦", label: "", x: null, y: null },
      takeMessage: "",
      returnMessage: "",
    };
    this._allPlacements.push(newP);
    this._placementsDirty = true;
    this._activePlacementId = newP.id;
    this._renderPlacementsList();
    this._redrawZoneCanvas();
  }

  _removePlacement(pi) {
    const removing = this._allPlacements[pi];
    this._allPlacements.splice(pi, 1);
    this._placementsDirty = true;
    if (removing && removing.id === this._activePlacementId) {
      const remaining = this._locPlacements();
      this._activePlacementId = remaining.length > 0 ? remaining[0].id : null;
    }
    this._renderPlacementsList();
    this._redrawZoneCanvas();
  }

  _setPlacementField(pi, field, val) {
    if (!this._allPlacements[pi]) return;
    this._allPlacements[pi][field] = val;
    this._placementsDirty = true;
    if (field === "id") {
      this._activePlacementId = val;
      this._refreshPlacementPicker();
    }
  }

  _setPlacementHotspot(pi, field, val) {
    if (!this._allPlacements[pi]) return;
    if (!this._allPlacements[pi].hotspot) this._allPlacements[pi].hotspot = {};
    this._allPlacements[pi].hotspot[field] = val;
    this._placementsDirty = true;
    this._redrawZoneCanvas();
  }

  _setPlacementCondition(pi, field, val) {
    if (!this._allPlacements[pi]) return;
    if (!this._allPlacements[pi].condition) this._allPlacements[pi].condition = {};
    this._allPlacements[pi].condition[field] = val;
    this._placementsDirty = true;
  }

  // ── background image band list ───────────────────────────────────────────────
  _renderBgList() {
    const tbody = this._el("le-bg-list");
    if (!tbody) return;
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    if (!loc.backgroundImages) loc.backgroundImages = [];
    tbody.innerHTML = loc.backgroundImages.map((band, i) => `
      <tr>
        <td><input type="number" min="0" max="100" placeholder="—" value="${band.sanMin ?? ""}"
          style="width:48px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setBgBandField(${i},'sanMin',this.value)"></td>
        <td><input type="number" min="0" max="100" placeholder="—" value="${band.sanMax ?? ""}"
          style="width:48px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._setBgBandField(${i},'sanMax',this.value)"></td>
        <td>
          ${this._imageSrc(band.image)
            ? `<img id="le-bg-img-${i}" src="${this._e(this._imageSrc(band.image))}" style="width:80px;height:45px;object-fit:cover;border:1px solid #555;vertical-align:middle" alt="图片预览" onerror="this.alt='图片加载失败'">`
            : `<span style="color:#aaa;font-size:11px">（空）</span>`}
          <input type="text" value="${this._e(band.image || "")}" placeholder="data/assets/location_xxx.jpg"
            style="width:220px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
            oninput="_le._setBgBandField(${i},'image',this.value)">
        </td>
        <td><button type="button" class="win95-btn dev-btn" onclick="_le._removeBgBand(${i})">✕</button></td>
      </tr>`).join("") || '<tr><td colspan="4" style="color:#aaa;font-size:11px;padding:6px">暂无背景图</td></tr>';
  }

  _addBgBand() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    if (!loc.backgroundImages) loc.backgroundImages = [];
    loc.backgroundImages.push({ sanMin: null, sanMax: null, image: "" });
    this._dirty = true;
    this._renderBgList();
  }

  _setBgBandField(i, field, val) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.backgroundImages?.[i]) return;
    loc.backgroundImages[i][field] = field === "image" ? val.trim() : (val === "" ? null : Number(val));
    this._dirty = true;
    if (field === "image") {
      // Reset cached bg so canvas reloads it
      this._bgImage = null;
      this._bgImageSrc = null;
      const preview = this._el(`le-bg-img-${i}`);
      if (preview) {
        preview.src = this._imageSrc(loc.backgroundImages[i].image);
        preview.alt = loc.backgroundImages[i].image ? "图片预览" : "";
      }
    }
  }

  _removeBgBand(i) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.backgroundImages) return;
    loc.backgroundImages.splice(i, 1);
    this._dirty = true;
    this._bgImage = null;
    this._bgImageSrc = null;
    this._renderBgList();
    this._redrawZoneCanvas();
  }

  // ── sub-location table ──────────────────────────────────────────────────────
  _renderSubTable() {
    const tbody = this._el("le-sub-tbody");
    if (!tbody) return;
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    tbody.innerHTML = (loc.subLocations || []).map((sub, i) => `
      <tr>
        <td><input type="text" value="${this._e(sub.id)}" style="width:120px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subInput(${i},'id',this.value)"></td>
        <td><input type="text" value="${this._e(sub.name)}" style="width:90px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subInput(${i},'name',this.value)"></td>
        <td><input type="number" value="${sub.zone?.x ?? 0}" style="width:50px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subZone(${i},'x',this.value)"></td>
        <td><input type="number" value="${sub.zone?.y ?? 0}" style="width:50px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subZone(${i},'y',this.value)"></td>
        <td><input type="number" value="${sub.zone?.width ?? 100}" style="width:50px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subZone(${i},'width',this.value)"></td>
        <td><input type="number" value="${sub.zone?.height ?? 60}" style="width:50px;min-height:20px;border:2px inset #eee;padding:1px 3px;font-size:11px"
          onchange="_le._subZone(${i},'height',this.value)"></td>
        <td><button type="button" class="win95-btn dev-btn" onclick="_le._removeSub(${i})">✕</button></td>
      </tr>`).join("");
  }

  _subInput(i, field, val) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.subLocations[i]) return;
    loc.subLocations[i][field] = val;
    this._dirty = true;
    this._updateZoneSection();
  }

  _subZone(i, field, val) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.subLocations[i]) return;
    if (!loc.subLocations[i].zone) loc.subLocations[i].zone = { x: 0, y: 0, width: 100, height: 60 };
    loc.subLocations[i].zone[field] = Number(val) || 0;
    this._dirty = true;
    this._redrawZoneCanvas();
  }

  _addSub() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    if (!loc.subLocations) loc.subLocations = [];
    loc.subLocations.push({ id: "sub_" + Math.random().toString(36).slice(2, 6), name: "子位置", zone: { x: 0, y: 0, width: 100, height: 60 } });
    this._dirty = true;
    this._renderSubTable();
    this._updateZoneSection();
  }

  _removeSub(i) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc?.subLocations) return;
    loc.subLocations.splice(i, 1);
    this._dirty = true;
    this._renderSubTable();
    this._updateZoneSection();
  }

  // ── zone canvas editor ──────────────────────────────────────────────────────
  _updateZoneSection() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    const section = this._el("le-zone-section");
    if (!section) return;
    // Always show canvas (needed for hotspot/placement modes even without subs)
    section.style.display = "";

    const sel = this._el("le-zone-sub-select");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = (loc?.subLocations || []).map((sub) =>
        `<option value="${this._e(sub.id)}">${this._e(sub.name || sub.id)}</option>`
      ).join("");
      if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }
    this._redrawZoneCanvas();
    this._bindCanvasDrag();
  }

  _onZoneSubChange() { this._redrawZoneCanvas(); this._updateHint(); }

  _redrawZoneCanvas() {
    const canvas = this._el("le-zone-canvas");
    if (!canvas) return;
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;

    const CANVAS_W = 640;
    const CANVAS_H = 360;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      if (this._bgImage) ctx.drawImage(this._bgImage, 0, 0, CANVAS_W, CANVAS_H);

      const mode = this._el("le-canvas-mode")?.value ?? "zone";
      const sel = this._el("le-zone-sub-select");
      const selectedSubId = sel?.value;

      // Sub-location zones (always drawn, dimmed in non-zone modes)
      (loc.subLocations || []).forEach((sub) => {
        const zone = sub.zone || { x: 0, y: 0, width: 100, height: 60 };
        const isSelected = sub.id === selectedSubId && mode === "zone";
        ctx.strokeStyle = isSelected ? "#ff5722" : "rgba(76,175,80,0.5)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
        ctx.fillStyle = isSelected ? "rgba(255,87,34,0.15)" : "rgba(76,175,80,0.05)";
        ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
        if (mode === "zone") {
          ctx.fillStyle = isSelected ? "#ff5722" : "rgba(76,175,80,0.8)";
          ctx.font = "11px sans-serif";
          ctx.fillText(sub.name || sub.id, zone.x + 3, zone.y + 13);
        }
      });

      // Hotspots
      if (mode === "hotspot") {
        (loc.hotspots || []).forEach((h) => {
          const x = h.x ?? 0, y = h.y ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,200,0,0.7)";
          ctx.fill();
          ctx.strokeStyle = "#cc6600";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = "#333";
          ctx.font = "14px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(h.icon || "❔", x, y);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = "#fff";
          ctx.font = "10px sans-serif";
          ctx.fillText(h.label || h.targetId || "", x + 13, y + 4);
        });
      }

      // Placements
      if (mode === "placement") {
        this._locPlacements().forEach((p) => {
          const x = p.hotspot?.x, y = p.hotspot?.y;
          if (x == null || y == null) return;
          const isActive = p.id === this._activePlacementId;
          ctx.beginPath();
          ctx.arc(x, y, isActive ? 13 : 9, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? "rgba(33,150,243,0.85)" : "rgba(33,150,243,0.45)";
          ctx.fill();
          ctx.strokeStyle = isActive ? "#0d47a1" : "#1565c0";
          ctx.lineWidth = isActive ? 2.5 : 1.5;
          ctx.stroke();
          ctx.font = "13px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#fff";
          ctx.fillText(p.hotspot?.icon || "📦", x, y);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillStyle = isActive ? "#e3f2fd" : "#90caf9";
          ctx.font = "10px sans-serif";
          ctx.fillText(p.hotspot?.label || p.id, x + 15, y + 4);
        });
      }
    };

    // Resolve bg image src
    const bgSrc = (loc.backgroundImages?.length > 0 && loc.backgroundImages[0].image)
      ? this._imageSrc(loc.backgroundImages[0].image)
      : (loc.backgroundImage ? this._imageSrc(loc.backgroundImage) : null);

    if (bgSrc) {
      // Re-use cached image if same URL
      if (this._bgImage && this._bgImageSrc === bgSrc) {
        draw();
      } else {
        const img = new Image();
        img.onload = () => { this._bgImage = img; this._bgImageSrc = bgSrc; draw(); };
        img.onerror = () => { this._bgImage = null; this._bgImageSrc = null; draw(); };
        img.src = bgSrc;
      }
    } else {
      this._bgImage = null;
      this._bgImageSrc = null;
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      draw();
    }

    this._updateHint();
  }

  _bindCanvasDrag() {
    const canvas = this._el("le-zone-canvas");
    if (!canvas || canvas.dataset.dragBound) return;
    canvas.dataset.dragBound = "1";

    const toCanvas = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (ev.clientX - rect.left) * scaleX, y: (ev.clientY - rect.top) * scaleY };
    };

    canvas.addEventListener("mousedown", (ev) => {
      const mode = this._el("le-canvas-mode")?.value ?? "zone";
      const pt = toCanvas(ev);
      const loc = this._locations.find((l) => l.id === this._currentId);
      if (!loc) return;

      if (mode === "hotspot") {
        if (!loc.hotspots) loc.hotspots = [];
        const existing = loc.hotspots.find((h) => Math.hypot((h.x ?? 0) - pt.x, (h.y ?? 0) - pt.y) < 14);
        if (existing) {
          this._dragHotspot = existing;
          this._dragging = true;
        } else {
          loc.hotspots.push({ targetId: "", label: "", icon: "❔", x: Math.round(pt.x), y: Math.round(pt.y) });
          this._dirty = true;
          this._renderHotspotTable();
        }
        ev.preventDefault();
        return;
      }

      if (mode === "placement") {
        const placements = this._locPlacements();
        // Try to grab an existing placed item
        const existing = placements.find((p) =>
          p.hotspot?.x != null && p.hotspot?.y != null &&
          Math.hypot(p.hotspot.x - pt.x, p.hotspot.y - pt.y) < 16
        );
        if (existing) {
          this._dragPlacement = existing;
          this._activePlacementId = existing.id;
          this._dragging = true;
          const sel = this._el("le-placement-pick");
          if (sel) sel.value = existing.id;
          this._updateHint();
        } else {
          // Place the active placement at click position
          const active = placements.find((p) => p.id === this._activePlacementId);
          if (active) {
            if (!active.hotspot) active.hotspot = {};
            active.hotspot.x = Math.round(pt.x);
            active.hotspot.y = Math.round(pt.y);
            this._placementsDirty = true;
            this._renderPlacementsList();
            this._redrawZoneCanvas();
          }
        }
        ev.preventDefault();
        return;
      }

      // zone mode
      const sel = this._el("le-zone-sub-select");
      if (!sel?.value) return;
      this._dragSubId = sel.value;
      this._dragStart = pt;
      this._dragging = true;
      ev.preventDefault();
    });

    canvas.addEventListener("mousemove", (ev) => {
      if (!this._dragging) return;
      const mode = this._el("le-canvas-mode")?.value ?? "zone";
      const pt = toCanvas(ev);

      if (mode === "hotspot" && this._dragHotspot) {
        this._dragHotspot.x = Math.round(pt.x);
        this._dragHotspot.y = Math.round(pt.y);
        this._dirty = true;
        this._redrawZoneCanvas();
        return;
      }

      if (mode === "placement" && this._dragPlacement) {
        if (!this._dragPlacement.hotspot) this._dragPlacement.hotspot = {};
        this._dragPlacement.hotspot.x = Math.round(pt.x);
        this._dragPlacement.hotspot.y = Math.round(pt.y);
        this._placementsDirty = true;
        this._redrawZoneCanvas();
        return;
      }

      if (!this._dragStart) return;
      const loc = this._locations.find((l) => l.id === this._currentId);
      const sub = (loc?.subLocations || []).find((s) => s.id === this._dragSubId);
      if (!sub) return;
      const x = Math.min(this._dragStart.x, pt.x);
      const y = Math.min(this._dragStart.y, pt.y);
      const w = Math.abs(pt.x - this._dragStart.x);
      const h = Math.abs(pt.y - this._dragStart.y);
      sub.zone = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
      this._dirty = true;
      this._redrawZoneCanvas();
    });

    const stopDrag = () => {
      if (!this._dragging) return;
      this._dragging = false;
      if (this._dragHotspot) {
        this._dragHotspot = null;
        this._renderHotspotTable();
      } else if (this._dragPlacement) {
        this._dragPlacement = null;
        this._renderPlacementsList();
      } else {
        this._renderSubTable();
      }
      this._dragStart = null;
      this._dragSubId = null;
    };
    canvas.addEventListener("mouseup", stopDrag);
    canvas.addEventListener("mouseleave", stopDrag);
  }

  // ── save / delete ────────────────────────────────────────────────────────────
  _saveLocation(silent) {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    const newId = this._el("le-f-id")?.value.trim() || loc.id;
    loc.id = newId;
    loc.name = this._el("le-f-name")?.value.trim() || loc.name;
    loc.layer = this._el("le-f-layer")?.value || "above";
    this._currentId = newId;
    this._dirty = false;
    locationSystem.update({ ...loc });
    if (!silent) {
      const msg = this._el("le-save-msg");
      if (msg) { msg.textContent = "✓ 已保存"; setTimeout(() => { msg.textContent = ""; }, 2000); }
    }
    this._renderList();
  }

  _deleteLocation() {
    if (!this._currentId || !confirm("确认删除这个位置？")) return;
    this._locations = this._locations.filter((l) => l.id !== this._currentId);
    this._currentId = null;
    this._dirty = false;
    const empty = this._el("le-editor-empty");
    const form  = this._el("le-editor-form");
    if (empty) empty.style.display = "";
    if (form)  form.style.display = "none";
    this._renderList();
  }

  // ── export / write ───────────────────────────────────────────────────────────
  exportJSON() {
    if (this._currentId && this._dirty) this._saveLocation(true);
    const dl = (name, data) => {
      const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    dl("locations.json", { locations: this._locations });
    dl("item_placements.json", { placements: this._allPlacements });
    this._st("locations.json 和 item_placements.json 已下载");
  }

  async writeToDisk() {
    if (this._currentId && this._dirty) this._saveLocation(true);
    try {
      await Promise.all([
        writeJSONToDisk("locations.json", { locations: this._locations }),
        writeJSONToDisk("item_placements.json", { placements: this._allPlacements }),
      ]);
      this._dirty = false;
      this._placementsDirty = false;
      this._st("✓ locations.json 和 item_placements.json 已写入磁盘");
    } catch (err) {
      this._st(`写入失败：${err.message}`);
    }
  }
}
// DEV-TOOLS:END
