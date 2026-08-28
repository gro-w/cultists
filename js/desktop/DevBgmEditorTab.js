// DEV-TOOLS:START
import { dataLoader, writeJSONToDisk } from "../core/DataLoader.js";
import { bgmManager, default as BgmManager } from "../core/BgmManager.js";

const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _uid = () => `bgm_${Date.now().toString(36).slice(-6)}`;

/**
 * DevBgmEditorTab — BGM resource manager panel for DeveloperMode.
 *
 * Capabilities:
 *   - Import BGM files (via <input type=file>) or register external URLs
 *   - List, rename, delete tracks
 *   - Preview playback (play / pause toggle)
 *   - Show cross-references (which rules / endings / dialogues use each track)
 *   - Edit default day+phase rules (day range, phase, priority, bgmId)
 *   - Set global fallback ("stop" | "continue")
 *   - Save to memory, download bgm.json, write to disk
 */
export class DevBgmEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    /** @type {{tracks: object[], defaultRules: object[], fallback: string}} */
    this._doc = null;
    this._previewingId = null;
    this._searchFilter = "";
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  html() {
    return `<div class="dev-bgm-root" id="bgm-root"></div>`;
  }

  mount() {
    window._bgm = this;
    this._load().catch((err) => this._st(`加载 BGM 数据失败：${err.message}`, true));
  }

  unmount() {
    bgmManager.stopPreview();
    this._previewingId = null;
    window._bgm = undefined;
  }

  // ── data ───────────────────────────────────────────────────────────────────

  async _load() {
    try {
      const raw = await dataLoader.loadJSON("bgm.json");
      this._doc = {
        tracks: Array.isArray(raw.tracks) ? raw.tracks.map((t) => ({ ...t })) : [],
        defaultRules: Array.isArray(raw.defaultRules) ? raw.defaultRules.map((r) => ({ ...r })) : [],
        fallback: raw.fallback || "stop",
      };
    } catch (_) {
      this._doc = { tracks: [], defaultRules: [], fallback: "stop" };
    }
    bgmManager.replaceData(this._doc);
    this._render();
  }

  _save() {
    if (!this._doc) return;
    bgmManager.replaceData(this._doc);
    dataLoader.clearCache("bgm.json");
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  _render() {
    const root = document.getElementById("bgm-root");
    if (!root) return;

    const tracks = this._doc.tracks;
    const rules  = this._doc.defaultRules;
    const fb     = this._doc.fallback;
    const filter = this._searchFilter.toLowerCase();

    const visibleTracks = filter
      ? tracks.filter((t) => t.id.toLowerCase().includes(filter) || (t.name || "").toLowerCase().includes(filter))
      : tracks;

    const trackRows = visibleTracks.map((t, origIdx) => {
      const idx = tracks.indexOf(t);
      const isPrev = this._previewingId === t.id;
      const usedByRules   = rules.filter((r) => r.bgmId === t.id).length;
      const usedByDialogue = this._countDialogueRefs(t.id);
      const usedByEndings  = this._countEndingRefs(t.id);
      const totalRefs = usedByRules + usedByDialogue + usedByEndings;
      const refTip = totalRefs
        ? `规则:${usedByRules} 对话:${usedByDialogue} 结局:${usedByEndings}`
        : "未使用";
      return `<tr class="dev-bgm-track-row">
        <td><code class="dev-bgm-id">${_esc(t.id)}</code></td>
        <td><input class="dev-bgm-name-input" data-bgm-track-name="${idx}"
              value="${_esc(t.name || "")}" placeholder="曲目名称"
              oninput="_bgm._onTrackNameChange(${idx},this.value)"></td>
        <td><input class="dev-bgm-src-input" data-bgm-track-src="${idx}"
              value="${_esc(t.src || "")}" placeholder="audio/bgm.ogg"
              oninput="_bgm._onTrackSrcChange(${idx},this.value)"></td>
        <td><input class="dev-bgm-note-input" data-bgm-track-note="${idx}"
              value="${_esc(t.note || "")}" placeholder="备注（可选）"
              oninput="_bgm._onTrackNoteChange(${idx},this.value)"></td>
        <td class="dev-bgm-ref-cell" title="${_esc(refTip)}">${totalRefs > 0 ? `<span class="dev-bgm-ref-badge">${totalRefs}</span>` : `<span class="dev-bgm-ref-none">—</span>`}</td>
        <td>
          <button class="win95-btn dev-btn dev-bgm-prev-btn${isPrev ? " active" : ""}"
            onclick="_bgm._togglePreview('${_esc(t.id)}')" title="预听">${isPrev ? "⏹" : "▶"}</button>
          <button class="win95-btn dev-btn dev-bgm-refs-btn"
            onclick="_bgm._showRefs('${_esc(t.id)}')" title="查看引用">🔍</button>
          <button class="win95-btn dev-btn dev-bgm-del-btn"
            onclick="_bgm._deleteTrack(${idx})" title="删除">✕</button>
        </td>
      </tr>`;
    }).join("");

    const ruleRows = rules.map((r, i) => `<tr class="dev-bgm-rule-row">
      <td>
        <input class="dev-bgm-wnum" type="number" min="1" max="7"
          value="${r.dayMin ?? ""}" placeholder="1"
          oninput="_bgm._onRuleChange(${i},'dayMin',this.value)">
        –
        <input class="dev-bgm-wnum" type="number" min="1" max="7"
          value="${r.dayMax ?? ""}" placeholder="7"
          oninput="_bgm._onRuleChange(${i},'dayMax',this.value)">
      </td>
      <td>
        <select class="dev-bgm-sel" onchange="_bgm._onRuleChange(${i},'phase',this.value)">
          <option value=""${!r.phase ? " selected" : ""}>全部</option>
          <option value="day"${r.phase === "day" ? " selected" : ""}>白天 (day)</option>
          <option value="night"${r.phase === "night" ? " selected" : ""}>夜晚 (night)</option>
        </select>
      </td>
      <td>
        <input class="dev-bgm-wnum" type="number" min="0" max="100"
          value="${r.sanMin ?? ""}" placeholder="0"
          title="理智值下限（含）；留空=不限"
          oninput="_bgm._onRuleChange(${i},'sanMin',this.value)">
        –
        <input class="dev-bgm-wnum" type="number" min="0" max="100"
          value="${r.sanMax ?? ""}" placeholder="100"
          title="理智值上限（含）；留空=不限"
          oninput="_bgm._onRuleChange(${i},'sanMax',this.value)">
      </td>
      <td>
        <select class="dev-bgm-sel dev-bgm-bgmid-sel" onchange="_bgm._onRuleChange(${i},'bgmId',this.value)">
          <option value="">（无 BGM）</option>
          ${tracks.map((t) => `<option value="${_esc(t.id)}"${r.bgmId === t.id ? " selected" : ""}>${_esc(t.name || t.id)}</option>`).join("")}
        </select>
        ${r.bgmId && !this._trackExists(r.bgmId) ? `<span class="dev-bgm-warn" title="找不到此 BGM ID">⚠️</span>` : ""}
      </td>
      <td>
        <input class="dev-bgm-wnum" type="number" min="0"
          value="${r.priority ?? 0}"
          oninput="_bgm._onRuleChange(${i},'priority',this.value)">
      </td>
      <td>
        <button class="win95-btn dev-btn dev-bgm-del-btn"
          onclick="_bgm._deleteRule(${i})">✕</button>
      </td>
    </tr>`).join("");

    root.innerHTML = `
<div class="dev-bgm-root-inner">
  <!-- Toolbar -->
  <div class="dev-bgm-toolbar">
    <label class="win95-btn dev-btn" title="从本机导入音频文件（仅记录文件名，需自行放入 audio/ 目录）">
      📂 导入音频文件
      <input type="file" accept="audio/*" multiple style="display:none"
        onchange="_bgm._onFileImport(event)">
    </label>
    <button class="win95-btn dev-btn" onclick="_bgm._addTrackByUrl()"
      title="手动输入 URL/路径注册曲目">＋ 手动注册</button>
    <button class="win95-btn dev-btn" onclick="_bgm._saveToMemory()">💾 保存到内存</button>
    <button class="win95-btn dev-btn" onclick="_bgm._download()">⬇ 下载 bgm.json</button>
    <button class="win95-btn dev-btn" onclick="_bgm._writeToDisk()">💽 写入磁盘</button>
  </div>

  <!-- Track list -->
  <div class="dev-bgm-section">
    <div class="dev-bgm-sec-hd">
      <span>🎵 曲目库（${tracks.length} 首）</span>
      <input class="dev-bgm-search" placeholder="搜索 ID / 名称…"
        value="${_esc(this._searchFilter)}"
        oninput="_bgm._onSearch(this.value)">
    </div>
    <div class="dev-bgm-table-wrap">
      <table class="dev-table dev-bgm-table">
        <thead><tr>
          <th>ID</th><th>名称</th><th>文件路径 / URL</th><th>备注</th><th>引用</th><th>操作</th>
        </tr></thead>
        <tbody>${trackRows || "<tr><td colspan='6' class='dev-bgm-empty'>暂无曲目。点击上方「导入」或「手动注册」添加。</td></tr>"}</tbody>
      </table>
    </div>
  </div>

  <!-- Default rules -->
  <div class="dev-bgm-section">
    <div class="dev-bgm-sec-hd">
      <span>📅 默认 BGM 规则（天数 + 时段）</span>
      <button class="win95-btn dev-btn" onclick="_bgm._addRule()">＋ 新增规则</button>
    </div>
    <p class="dev-bgm-hint">同时匹配多条规则时，priority 数值更高的优先。留空天数 = 所有天。留空时段 = 白天和夜晚都匹配。</p>
    <div class="dev-bgm-table-wrap">
      <table class="dev-table dev-bgm-table">
        <thead><tr>
          <th>天数范围（dayMin–dayMax）</th><th>时段</th><th>理智值范围（sanMin–sanMax）</th><th>BGM</th><th>优先级</th><th>删除</th>
        </tr></thead>
        <tbody>${ruleRows || "<tr><td colspan='6' class='dev-bgm-empty'>暂无规则。</td></tr>"}</tbody>
      </table>
    </div>
    <div class="dev-bgm-fb-row">
      <label>无规则匹配时 Fallback：
        <select class="dev-bgm-sel" onchange="_bgm._onFallbackChange(this.value)">
          <option value="stop"${fb === "stop" ? " selected" : ""}>停止播放 (stop)</option>
          <option value="continue"${fb === "continue" ? " selected" : ""}>继续当前 BGM (continue)</option>
        </select>
      </label>
    </div>
  </div>
</div>`;
  }

  // ── event handlers ────────────────────────────────────────────────────────

  _st(msg, err = false) { this._dev.setStatus(msg, err); }

  _onSearch(val) {
    this._searchFilter = val;
    this._render();
  }

  _onFileImport(ev) {
    const files = Array.from(ev.target.files);
    ev.target.value = "";
    files.forEach((f) => {
      const suggested = `audio/${f.name}`;
      const id = _uid();
      this._doc.tracks.push({
        id,
        name: f.name.replace(/\.[^.]+$/, ""),
        src: suggested,
        note: "",
      });
    });
    this._save();
    this._render();
    this._st(`已注册 ${files.length} 条曲目记录。请将音频文件放入 audio/ 目录。`);
  }

  _addTrackByUrl() {
    const src = prompt("输入音频文件路径或 URL（例如 audio/bgm_day.ogg）：", "audio/");
    if (!src) return;
    const name = src.split("/").pop().replace(/\.[^.]+$/, "");
    this._doc.tracks.push({ id: _uid(), name, src, note: "" });
    this._save();
    this._render();
  }

  _onTrackNameChange(idx, val) {
    if (!this._doc.tracks[idx]) return;
    this._doc.tracks[idx].name = val;
    this._save();
  }

  _onTrackSrcChange(idx, val) {
    if (!this._doc.tracks[idx]) return;
    this._doc.tracks[idx].src = val;
    this._save();
  }

  _onTrackNoteChange(idx, val) {
    if (!this._doc.tracks[idx]) return;
    this._doc.tracks[idx].note = val;
    this._save();
  }

  _deleteTrack(idx) {
    const t = this._doc.tracks[idx];
    if (!t) return;
    const totalRefs = this._countDialogueRefs(t.id) + this._countEndingRefs(t.id)
      + this._doc.defaultRules.filter((r) => r.bgmId === t.id).length;
    if (totalRefs > 0) {
      const ok = confirm(
        `⚠️ 曲目「${t.name || t.id}」仍有 ${totalRefs} 处引用。\n`
        + `删除后这些引用将失效（游戏不会崩溃，但不会播放音乐）。\n确认删除？`
      );
      if (!ok) return;
    }
    this._doc.tracks.splice(idx, 1);
    if (this._previewingId === t.id) {
      bgmManager.stopPreview();
      this._previewingId = null;
    }
    this._save();
    this._render();
  }

  _onRuleChange(idx, field, val) {
    const r = this._doc.defaultRules[idx];
    if (!r) return;
    if (["dayMin", "dayMax", "sanMin", "sanMax", "priority"].includes(field)) {
      const n = parseInt(val, 10);
      r[field] = isNaN(n) ? null : n;
    } else if (field === "phase") {
      r[field] = val || null;
    } else {
      r[field] = val || null;
    }
    // Re-render just the warn badges without full re-render (keep focus)
    this._save();
    // Show warning if bgmId is now invalid
    const sel = document.querySelector(`.dev-bgm-rule-row:nth-child(${idx + 1}) .dev-bgm-bgmid-sel`);
    const warn = sel?.nextElementSibling;
    if (warn) warn.style.display = (r.bgmId && !this._trackExists(r.bgmId)) ? "" : "none";
  }

  _addRule() {
    this._doc.defaultRules.push({ id: _uid(), dayMin: null, dayMax: null, phase: null, sanMin: null, sanMax: null, bgmId: null, priority: 0 });
    this._save();
    this._render();
  }

  _deleteRule(idx) {
    this._doc.defaultRules.splice(idx, 1);
    this._save();
    this._render();
  }

  _onFallbackChange(val) {
    this._doc.fallback = val;
    this._save();
  }

  // ── preview ───────────────────────────────────────────────────────────────

  _togglePreview(trackId) {
    if (this._previewingId === trackId) {
      bgmManager.stopPreview();
      this._previewingId = null;
    } else {
      bgmManager.previewTrack(trackId);
      this._previewingId = trackId;
    }
    this._render();
  }

  // ── reference scanning ────────────────────────────────────────────────────

  _countDialogueRefs(bgmId) {
    let count = 0;
    const project = this._dev._dialogueEditorTab?.project;
    if (!project) return count;
    const scanCtx = (ctx) => {
      if (!ctx?.nodes) return;
      Object.values(ctx.nodes).forEach((n) => {
        if (n?.onShow?.bgm?.bgmId === bgmId) count++;
      });
    };
    Object.values(project.schedules || {}).forEach((sched) =>
      (sched.entries || []).forEach((e) => scanCtx(e.dialogueTree))
    );
    Object.values(project.events || {}).forEach(scanCtx);
    Object.values(project.endings || {}).forEach(scanCtx);
    return count;
  }

  _countEndingRefs(bgmId) {
    let count = 0;
    const fileDoc = this._dev._dialogueEditorTab?.project?.endingFileDoc;
    if (!fileDoc) return count;
    (fileDoc.endings || []).forEach((e) => { if (e.bgmId === bgmId) count++; });
    return count;
  }

  _trackExists(bgmId) {
    return this._doc.tracks.some((t) => t.id === bgmId);
  }

  _showRefs(bgmId) {
    const refs = [];
    const proj = this._dev._dialogueEditorTab?.project;
    if (proj) {
      Object.entries(proj.schedules || {}).forEach(([key, sched]) =>
        (sched.entries || []).forEach((e, ei) => {
          const r = (e.dialogueTree ? BgmManager.scanDialogueTree(e.dialogueTree) : []).filter((x) => x.bgmId === bgmId);
          r.forEach((x) => refs.push(`日程 ${key} 条目#${ei + 1} 节点 ${x.nodeId}`));
        })
      );
      Object.entries(proj.events || {}).forEach(([id, ctx]) => {
        const r = (ctx ? BgmManager.scanDialogueTree(ctx) : []).filter((x) => x.bgmId === bgmId);
        r.forEach((x) => refs.push(`事件 ${id} 节点 ${x.nodeId}`));
      });
      (proj.endingFileDoc?.endings || []).forEach((e) => {
        if (e.bgmId === bgmId) refs.push(`结局 ${e.id} (bgmId 字段)`);
      });
    }
    this._doc.defaultRules.forEach((r, i) => {
      if (r.bgmId === bgmId) refs.push(`默认规则 #${i + 1}`);
    });
    const track = this._doc.tracks.find((t) => t.id === bgmId);
    const name = track ? track.name || bgmId : bgmId;
    if (!refs.length) {
      alert(`曲目「${name}」目前没有任何引用。`);
    } else {
      alert(`曲目「${name}」的引用（共 ${refs.length} 处）：\n\n` + refs.join("\n"));
    }
  }

  // ── persistence ───────────────────────────────────────────────────────────

  _saveToMemory() {
    this._save();
    this._st("BGM 数据已保存到内存。");
  }

  _download() {
    const json = JSON.stringify(this._doc, null, 2) + "\n";
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bgm.json";
    a.click();
    URL.revokeObjectURL(a.href);
    this._st("bgm.json 已下载。");
  }

  async _writeToDisk() {
    try {
      await writeJSONToDisk("bgm.json", this._doc);
      this._st("✅ bgm.json 已写入磁盘。");
    } catch (err) {
      this._st(`✗ 写入磁盘失败：${err.message}`, true);
    }
  }
}

// DEV-TOOLS:END
