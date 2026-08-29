// DEV-TOOLS:START
import { dataLoader, writeJSONToDisk } from "../core/DataLoader.js";
import { cgManager } from "../core/CGManager.js";

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let _uidSequence = 0;
const _uid = () => `cg_${Date.now().toString(36).slice(-6)}_${(++_uidSequence).toString(36)}`;

/**
 * DevCGEditorTab — CG image resource manager panel for DeveloperMode.
 *
 * Capabilities:
 *   - Upload CG images (base64 imageData stored in cg.json)
 *   - Assign stable cgId and display label
 *   - Preview images inline
 *   - Delete entries
 *   - Preview CG overlay in the running game (emits cg:show / cg:end)
 *   - Save to memory, download cg.json, write to disk
 */
export class DevCGEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    this._root = null;
    /** @type {{ cgs: {id:string, label:string, imageData:string}[] }} */
    this._doc = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  html() {
    return `<div class="dev-cg-root" id="cg-editor-root"></div>`;
  }

  mount(root = null) {
    this._root = root || this._dev.root.querySelector(".dev-cg-root");
    if (!this._root) {
      this._st("CG 编辑器挂载失败：找不到编辑器根节点。", true);
      return;
    }
    window._cg = this;
    this._root?.addEventListener("pointerdown", () => { window._cg = this; });
    this._load().catch((err) => {
      this._root.innerHTML = `<p class="dev-error">加载 CG 数据失败：${_esc(err.message)}</p>`;
      this._st(`加载 CG 数据失败：${err.message}`, true);
    });
  }

  unmount() {
    if (window._cg === this) window._cg = null;
  }

  // ── data ───────────────────────────────────────────────────────────────────

  async _load() {
    try {
      const raw = await dataLoader.loadJSON("cg.json");
      this._doc = { cgs: Array.isArray(raw.cgs) ? raw.cgs.map((cg) => ({ ...cg })) : [] };
    } catch (_) {
      this._doc = { cgs: [] };
    }
    this._render();
    this._st("cg.json 已读取。");
  }

  _save() {
    if (!this._doc) return;
    cgManager.replaceData(this._doc);
  }

  _collectFromDom() {
    const root = this._root;
    if (!root) return;
    const ids = new Set();
    this._doc.cgs = Array.from(root.querySelectorAll("[data-cg-row]")).map((row) => {
      const cg = this._doc.cgs[Number(row.dataset.cgRow)] || {};
      const id = row.querySelector("[data-cg-id]").value.trim();
      if (!id) throw new Error("CG ID 不能为空");
      if (ids.has(id)) throw new Error(`重复的 CG ID：${id}`);
      ids.add(id);
      return {
        id,
        label: row.querySelector("[data-cg-label]").value.trim(),
        imageData: cg.imageData || "",
      };
    });
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  _render() {
    const root = this._root;
    if (!root) return;

    const rows = (this._doc?.cgs || []).map((cg, i) => `
      <article class="dev-cg-card" data-cg-row="${i}">
        <div class="dev-cg-card-header">
          <b>CG ${i + 1}</b>
          <button type="button" class="win95-btn dev-btn" data-cg-action="remove" data-cg-idx="${i}">✕ 删除</button>
          <button type="button" class="win95-btn dev-btn" data-cg-action="preview" data-cg-idx="${i}" title="在游戏内预览">▶ 预览</button>
        </div>
        <div class="dev-cg-fields">
          <label>CG ID <input data-cg-id value="${_esc(cg.id)}" style="width:140px"></label>
          <label>标签 <input data-cg-label value="${_esc(cg.label)}" style="width:180px"
            oninput="_cg._onLabelInput(this)"></label>
          <label class="dev-cg-upload-label" title="替换此 CG 图片">
          📁 替换图片
          <input type="file" accept="image/*" data-cg-upload="${i}" style="display:none">
          </label>
        </div>
        <div class="dev-cg-preview">
          ${cg.imageData
            ? `<img src="${_esc(cg.imageData)}" alt="CG 预览" class="dev-cg-thumb" data-cg-idx="${i}">`
            : `<span class="dev-cg-no-img">（未上传图片）</span>`}
        </div>
      </article>`).join("");

    root.innerHTML = `
      <div class="dev-cg-toolbar">
        <button type="button" class="win95-btn dev-btn" data-cg-action="add">＋ 添加 CG</button>
        <label class="win95-btn dev-btn" title="一次选择多张图片，每张图片创建一个新的 CG">
          📁 批量上传新 CG
          <input type="file" accept="image/*" multiple data-cg-batch-upload style="display:none">
        </label>
        <button type="button" class="win95-btn dev-btn" data-cg-action="end-preview" title="结束当前游戏内预览">■ 结束预览</button>
        <button type="button" class="win95-btn dev-btn" data-cg-action="save">💾 保存到内存</button>
        <button type="button" class="win95-btn dev-btn" data-cg-action="download">⬇ 下载 cg.json</button>
        <button type="button" class="win95-btn dev-btn" data-cg-action="write">🖊 写入磁盘</button>
      </div>
      <p style="font-size:11px;color:#aaa;margin:4px 0 8px">
        在此管理游戏内 CG 背景图。日程编辑器里用 <code>showCg</code>（显示 CG）和 <code>endCg</code>（结束 CG）节点触发。
        CG 激活时物品层不可交互。
      </p>
      <div id="dev-cg-list">${rows || "<p style='color:#aaa;font-size:12px'>暂无 CG，点击「添加 CG」。</p>"}</div>`;

    // Bind toolbar buttons
    root.querySelector("[data-cg-action='add']").addEventListener("click", () => this._add());
    root.querySelector("[data-cg-action='save']").addEventListener("click", () => this._doSave());
    root.querySelector("[data-cg-action='download']").addEventListener("click", () => this._doDownload());
    root.querySelector("[data-cg-action='write']").addEventListener("click", () => this._doWrite());
    root.querySelector("[data-cg-batch-upload]").addEventListener("change", (event) => this._onBatchUpload(event));
    root.querySelector("[data-cg-action='end-preview']").addEventListener("click", () => {
      cgManager.end();
      this._st("CG 预览已结束。");
    });

    // Bind per-row buttons
    root.querySelectorAll("[data-cg-action='remove']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.cgIdx);
        this._doc.cgs.splice(idx, 1);
        this._save();
        this._render();
      });
    });
    root.querySelectorAll("[data-cg-action='preview']").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._collectAndSave();
        const idx = Number(btn.dataset.cgIdx);
        const cg = this._doc.cgs[idx];
        if (!cg?.id) { this._st("请先填写 CG ID。", true); return; }
        cgManager.show(cg.id);
        this._st(`正在预览 CG：${cg.id}`);
      });
    });

    // Bind file upload inputs
    root.querySelectorAll("[data-cg-upload]").forEach((input) => {
      input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const idx = Number(input.dataset.cgUpload);
        const reader = new FileReader();
        reader.onload = () => {
          if (!this._doc.cgs[idx]) return;
          this._doc.cgs[idx].imageData = reader.result;
          this._save();
          this._render();
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ── actions ────────────────────────────────────────────────────────────────

  _readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async _onBatchUpload(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || !this._doc) return;
    if (!this._collectAndSave()) return;

    try {
      const images = await Promise.all(files.map((file) => this._readImageFile(file)));
      const existingIds = new Set(this._doc.cgs.map((cg) => cg.id));
      images.forEach((imageData, index) => {
        const file = files[index];
        let id = _uid();
        while (existingIds.has(id)) id = _uid();
        existingIds.add(id);
        const label = file.name.replace(/\.[^.]+$/, "") || "新 CG";
        this._doc.cgs.push({ id, label, imageData });
      });
      this._save();
      this._render();
      this._st(`已批量创建 ${images.length} 个新 CG，请修改标签名称。`);
    } catch (err) {
      this._st(`批量上传失败：${err.message}`, true);
    }
  }

  _onLabelInput(input) {
    const row = input.closest("[data-cg-row]");
    const index = Number(row?.dataset.cgRow);
    if (!this._doc?.cgs?.[index]) return;
    this._doc.cgs[index].label = input.value;
    this._save();
  }

  _add() {
    if (!this._doc) return;
    this._doc.cgs.push({ id: _uid(), label: "新 CG", imageData: "" });
    this._save();
    this._render();
  }

  _collectAndSave() {
    try {
      this._collectFromDom();
    } catch (err) {
      this._st(err.message, true);
      return false;
    }
    this._save();
    return true;
  }

  _doSave() {
    if (!this._collectAndSave()) return;
    this._st("cg.json 已保存到内存。");
  }

  _doDownload() {
    if (!this._collectAndSave()) return;
    const blob = new Blob([`${JSON.stringify(this._doc, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cg.json";
    a.click();
    URL.revokeObjectURL(url);
    this._st("cg.json 已下载。");
  }

  async _doWrite() {
    if (!this._collectAndSave()) return;
    try { await this._dev.writeToDisk("cg.json", this._doc); }
    catch (err) { this._st(`写入磁盘失败：${err.message}`, true); }
  }

  _st(text, error = false) {
    this._dev.setStatus(text, error);
  }
}
// DEV-TOOLS:END
