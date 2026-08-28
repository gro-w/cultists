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
        <div class="dev-ie-field">
          <label>背景图片（Base64 data URL 或空）</label>
          <div style="display:flex;gap:8px;align-items:flex-start">
            <div id="le-bg-preview" style="width:120px;height:68px;border:2px inset #eee;background:#222;flex:0 0 auto;overflow:hidden">
              <img id="le-bg-img" style="width:100%;height:100%;object-fit:cover;display:none" alt="">
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <button type="button" class="win95-btn dev-btn" onclick="_le._el('le-bg-file').click()">上传背景图</button>
              <button type="button" class="win95-btn dev-btn" onclick="_le._clearBg()">清除背景</button>
              <input type="file" id="le-bg-file" accept="image/*" style="display:none" onchange="_le._onBgFile(event)">
            </div>
          </div>
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

      <div class="dev-section dev-ie-sec" id="le-zone-section" style="display:none"><h3>🖼 区域编辑器</h3>
        <p style="font-size:11px;color:#888;margin:0 0 6px">在背景图上拖动鼠标，为选中的子位置绘制/调整区域矩形。</p>
        <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px">编辑子位置：</label>
          <select id="le-zone-sub-select" onchange="_le._onZoneSubChange()" style="min-height:22px;border:2px inset #eee;padding:1px 4px;font-size:12px"></select>
        </div>
        <canvas id="le-zone-canvas" style="border:2px inset #ccc;cursor:crosshair;max-width:100%;background:#111"></canvas>
        <p id="le-zone-hint" style="font-size:11px;color:#888;margin-top:4px"></p>
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
    const newLoc = { id: "loc_" + Math.random().toString(36).slice(2, 7), name: "新位置", backgroundImage: "", layer: "above", subLocations: [] };
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

    const bgImg = this._el("le-bg-img");
    if (bgImg) {
      bgImg.src = loc.backgroundImage || "";
      bgImg.style.display = loc.backgroundImage ? "" : "none";
    }

    this._renderSubTable();
    this._updateZoneSection();
  }

  _setDirty() { this._dirty = true; }

  _onBgFile(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (e) => {
      const loc = this._locations.find((l) => l.id === this._currentId);
      if (!loc) return;
      loc.backgroundImage = e.target.result;
      const bgImg = this._el("le-bg-img");
      if (bgImg) { bgImg.src = e.target.result; bgImg.style.display = ""; }
      this._dirty = true;
      this._redrawZoneCanvas();
    };
    r.readAsDataURL(f);
  }

  _clearBg() {
    const loc = this._locations.find((l) => l.id === this._currentId);
    if (!loc) return;
    loc.backgroundImage = "";
    const bgImg = this._el("le-bg-img");
    if (bgImg) { bgImg.src = ""; bgImg.style.display = "none"; }
    this._dirty = true;
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
      // Draw all sub-location zones
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
    };

    if (loc.backgroundImage) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); draw(); };
      img.onerror = () => draw();
      img.src = loc.backgroundImage;
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
      const sel = this._el("le-zone-sub-select");
      if (!sel?.value) return;
      this._dragSubId = sel.value;
      this._dragStart = toCanvas(ev);
      this._dragging = true;
      ev.preventDefault();
    });

    canvas.addEventListener("mousemove", (ev) => {
      if (!this._dragging || !this._dragStart) return;
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
        this._renderSubTable(); // refresh coordinate inputs
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
