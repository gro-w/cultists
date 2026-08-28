// DEV-TOOLS:START
import { dataLoader, writeJSONToDisk } from "../core/DataLoader.js";
import { locationSystem } from "../core/LocationSystem.js";

/**
 * DevLocationEditorTab — edit location definitions (backgroundImage, layer,
 * sub-locations and their zone rectangles) inside DeveloperMode.
 *
 * Zone rect editor: draws the background image on a canvas and lets the
 * developer drag to define/reposition each sub-location zone. Zones are
 * saved as { x, y, width, height } in locations.json.
 *
 * Inline onclick= handlers reference window._le (set to `this` on mount).
 */
export class DevLocationEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    /** @type {Array} */
    this._locations = [];
    this._currentId = null;
    this._dirty = false;
    // Zone drag state
    this._dragging = false;
    this._dragSubId = null;
    this._dragStart = null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  _el(id) { return document.getElementById(id); }
  _e(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  _imageSrc(value) {
    const path = typeof value === "string" ? value.trim() : "";
    if (!path) return "";
    try { return new URL(path, document.baseURI).href; } catch (_) { return path; }
  }
  _st(s) { this._dev.setStatus(s); }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  mount() {
    window._le = this;
    this._loadData();
  }

  unmount() {
    window._le = null;
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
          </select>
          <span id="le-zone-sub-wrap" style="display:flex;gap:4px;align-items:center">
            <label style="font-size:12px">编辑子位置：</label>
            <select id="le-zone-sub-select" onchange="_le._onZoneSubChange()" style="min-height:22px;border:2px inset #eee;padding:1px 4px;font-size:12px"></select>
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
      const data = await dataLoader.loadJSON("locations.json");
      this._locations = JSON.parse(JSON.stringify(data.locations || []));
      this._currentId = null;
      this._renderList();
      this._st(`已读取 locations.json：${this._locations.length} 个位置`);
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
  }

  _setDirty() { this._dirty = true; }

  // ── canvas mode switch ───────────────────────────────────────────────────────
  _onCanvasModeChange() {
    const mode = this._el("le-canvas-mode")?.value ?? "zone";
    const zoneWrap    = this._el("le-zone-sub-wrap");
    const hotspotSec  = this._el("le-hotspot-section");
    if (zoneWrap)   zoneWrap.style.display   = mode === "zone"    ? "" : "none";
    if (hotspotSec) hotspotSec.style.display = mode === "hotspot" ? "" : "none";
    this._redrawZoneCanvas();
    if (mode === "hotspot") this._renderHotspotTable();
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
          <input type="text" value="${this._e(band.image || "")}" placeholder="data/assets/location_dorm_xxx.jpg"
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
    const hasSubs = (loc?.subLocations?.length || 0) > 0;
    section.style.display = hasSubs ? "" : "none";
    if (!hasSubs) return;

    const sel = this._el("le-zone-sub-select");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = (loc.subLocations || []).map((sub) =>
        `<option value="${this._e(sub.id)}">${this._e(sub.name || sub.id)}</option>`
      ).join("");
      if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }
    this._redrawZoneCanvas();
    this._bindCanvasDrag();
  }

  _onZoneSubChange() { this._redrawZoneCanvas(); }

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
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw background
    const draw = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      const mode = this._el("le-canvas-mode")?.value ?? "zone";

      // Draw sub-location zones (zone mode)
      const sel = this._el("le-zone-sub-select");
      const selectedSubId = sel?.value;
      (loc.subLocations || []).forEach((sub) => {
        const zone = sub.zone || { x: 0, y: 0, width: 100, height: 60 };
        const isSelected = sub.id === selectedSubId;
        ctx.strokeStyle = isSelected ? "#ff5722" : "#4caf50";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
        ctx.fillStyle = isSelected ? "rgba(255,87,34,0.15)" : "rgba(76,175,80,0.1)";
        ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
        ctx.fillStyle = isSelected ? "#ff5722" : "#4caf50";
        ctx.font = "11px sans-serif";
        ctx.fillText(sub.name || sub.id, zone.x + 3, zone.y + 13);
      });

      // Draw hotspots (hotspot mode)
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
          ctx.font = "12px sans-serif";
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
    };

    if (loc.backgroundImages?.length > 0 && loc.backgroundImages[0].image) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); draw(); };
      img.onerror = () => draw();
      img.src = this._imageSrc(loc.backgroundImages[0].image);
    } else if (loc.backgroundImage) {
      // legacy fallback
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); draw(); };
      img.onerror = () => draw();
      img.src = this._imageSrc(loc.backgroundImage);
    } else {
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      draw();
    }

    const hint = this._el("le-zone-hint");
    if (hint) {
      const sel = this._el("le-zone-sub-select");
      hint.textContent = sel?.value ? `拖动鼠标在背景图上为「${sel.options[sel.selectedIndex]?.text}」绘制区域矩形。` : "";
    }
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
      if (mode === "hotspot") {
        // Click to place hotspot at cursor
        const pt = toCanvas(ev);
        const loc = this._locations.find((l) => l.id === this._currentId);
        if (!loc) return;
        if (!loc.hotspots) loc.hotspots = [];
        // Check if near existing hotspot (move it)
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
      const sel = this._el("le-zone-sub-select");
      if (!sel?.value) return;
      this._dragSubId = sel.value;
      this._dragStart = toCanvas(ev);
      this._dragging = true;
      ev.preventDefault();
    });

    canvas.addEventListener("mousemove", (ev) => {
      if (this._dragHotspot && this._dragging) {
        const cur = toCanvas(ev);
        this._dragHotspot.x = Math.round(cur.x);
        this._dragHotspot.y = Math.round(cur.y);
        this._dirty = true;
        this._redrawZoneCanvas();
        return;
      }
      if (!this._dragging || !this._dragStart) return;
      const mode = this._el("le-canvas-mode")?.value ?? "zone";
      if (mode === "hotspot") return;
      const cur = toCanvas(ev);
      const loc = this._locations.find((l) => l.id === this._currentId);
      const sub = (loc?.subLocations || []).find((s) => s.id === this._dragSubId);
      if (!sub) return;
      const x = Math.min(this._dragStart.x, cur.x);
      const y = Math.min(this._dragStart.y, cur.y);
      const w = Math.abs(cur.x - this._dragStart.x);
      const h = Math.abs(cur.y - this._dragStart.y);
      sub.zone = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
      this._dirty = true;
      this._redrawZoneCanvas();
    });

    const stopDrag = () => {
      if (this._dragging) {
        this._dragging = false;
        if (this._dragHotspot) {
          this._dragHotspot = null;
          this._renderHotspotTable();
        } else {
          this._renderSubTable(); // refresh coordinate inputs
        }
        this._dragStart = null;
      }
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
    // Update LocationSystem in memory
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
    if (form) form.style.display = "none";
    this._renderList();
  }

  // ── export / write ───────────────────────────────────────────────────────────
  exportJSON() {
    if (this._currentId && this._dirty) this._saveLocation(true);
    const blob = new Blob([JSON.stringify({ locations: this._locations }, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locations.json";
    a.click();
    URL.revokeObjectURL(a.href);
    this._st("locations.json 已下载");
  }

  async writeToDisk() {
    if (this._currentId && this._dirty) this._saveLocation(true);
    const ok = await this._dev.writeToDisk("locations.json", { locations: this._locations });
    if (ok) this._st("locations.json 已写入磁盘");
  }
}
// DEV-TOOLS:END
