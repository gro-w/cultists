// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";
import { locationSystem } from "../core/LocationSystem.js";
import { DevDialogueEditorTab } from "./DevDialogueEditorTab.js";
import { createEmptyBlueprint } from "../core/ScheduleBlueprint.js";

/**
 * DevItemEditorTab — item-editor.html/js ported into the DeveloperMode panel.
 * Inline onclick= handlers reference window._ie (set to `this` on mount).
 */

const _IE_LS  = 'cultists_item_editor_v2';
const _IE_BANDS = [
  { key:'>90',   label:'SAN>90',     color:'#2e7d32' },
  { key:'70-90', label:'70<SAN≤90',  color:'#1565c0' },
  { key:'50-70', label:'50<SAN≤70',  color:'#6a1b9a' },
  { key:'30-50', label:'30<SAN≤50',  color:'#e65100' },
  { key:'15-30', label:'15<SAN≤30',  color:'#c62828' },
  { key:'0-15',  label:'0<SAN≤15',   color:'#4a148c' },
  { key:'=0',    label:'SAN=0',      color:'#880e4f' },
];

export class DevItemEditorTab {
  constructor(devMode, options = {}) {
    this._dev = devMode;
    this.items = [];
    this.currentId = null;
    this.activeTab = 'items';
    this.currentSpellKey = null;
    this.activeSanKey = '>90';
    this._selectedSanImageKeys = new Set();
    this.dirty = false;
    this._initialItemId = options.initialItemId || null;
    this.root = null;
    this._investigateEditor = null;
    this._investigateEditorHost = null;
    this._useEditor = null;
    this._useEditorHost = null;
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  _el(id) { return (this.root || document).querySelector(`#${id}`); }
  _v(id)  { const e=this._el(id); return e?e.value:''; }
  _vi(id) { return parseInt(this._v(id))||0; }
  _vc(id) { const e=this._el(id); return e?e.checked:false; }
  _e(s)   { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  _uid()  { return 'item_'+Math.random().toString(36).slice(2,8); }
  _st(s)  { this._dev.setStatus(s); }
  _imageSrc(value) {
    const path = typeof value === 'string' ? value.trim() : '';
    if (!path) return '';
    try { return new URL(path, document.baseURI).href; } catch (_) { return path; }
  }
  _assetPaths() {
    const paths = new Set();
    this.items.forEach((item) => Object.values(item.sanVariants || {}).forEach((variant) => {
      const path = typeof variant?.image === 'string' ? variant.image.trim() : '';
      if (path && !path.startsWith('data:')) paths.add(path);
    }));
    return [...paths].sort();
  }

  _emptyItem() {
    const v={};
    _IE_BANDS.forEach(b=>{
      v[b.key]={name:'',description:'',image:'',revealKeywordIds:[],
        inspEffect:{gameEvent:'',mental:0,ending:''}};
    });
    return {
      id:this._uid(), defaultName:'', worldCount:1, inspectText:'', inspectTimeAdvance:0,
      revealKeywordIds:[], locations:[], pickable:false, usable:false, consumable:false, isBook:false,
      useCondition:{sanMin:0,sanMax:0},
      schedules:{},
      sanVariants:v,
      bookContents:[], spells:[],
    };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  /** Called by DeveloperMode after injecting html() into the panel. */
  mount(root = null) {
    this.root = root || this._dev.root.querySelector('.dev-ie-root') || document;
    window._ie = this;
    this.root.addEventListener('pointerdown', () => { window._ie = this; });
    this._loadCurrentGame(this._initialItemId);
    this._renderList();
    this._loadLocationPicker();
  }

  // ── HTML skeleton (returned to DeveloperMode.showItemEditor) ─────────────
  html() {
    return `<div class="dev-ie-root">
<div class="dev-ie-toolbar">
  <strong style="font-size:13px">物品与法术编辑器</strong>
  <button type="button" class="win95-btn dev-btn" onclick="_ie._switchTab('items')">📦 物品</button>
  <button type="button" class="win95-btn dev-btn" onclick="_ie._switchTab('spells')">✨ 法术</button>
  <button type="button" class="win95-btn dev-btn" onclick="_ie._loadCurrentGame()">⬇ 从当前游戏读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_ie.exportJSON()">📤 导出 JSON</button>
  <button type="button" class="win95-btn dev-btn" onclick="_ie.writeToGame()">💽 写入磁盘</button>
  <input type="file" id="ie-file-input" accept=".json" style="display:none" onchange="_ie._onFile(event)">
</div>
<div class="dev-ie-main" id="ie-item-main">
  <aside class="dev-ie-sidebar">
    <div class="dev-ie-sidebar-hd">
      <input id="ie-search" placeholder="搜索名称/ID…" oninput="_ie._renderList()">
      <button type="button" class="win95-btn dev-btn" onclick="_ie.addItem()">＋</button>
    </div>
    <div id="ie-item-list" class="dev-ie-item-list"></div>
  </aside>
  <section id="ie-editor" class="dev-ie-editor">
    <div id="ie-editor-empty" style="color:#aaa;padding:40px;text-align:center">← 选择物品或点击 ＋ 新建</div>
    <div id="ie-editor-form" style="display:none;padding:10px">
      <div class="dev-section dev-ie-sec"><h3>📋 基本信息</h3>
        <div class="dev-ie-row">
          <div class="dev-ie-field"><label>物品 ID</label><input type="text" id="f-id"></div>
          <div class="dev-ie-field"><label>名称</label><input type="text" id="f-defaultName" oninput="_ie._onNameInput()"></div>
          <div class="dev-ie-field" style="flex:0"><label>世界数量</label><input type="number" id="f-worldCount" min="1" value="1" style="width:70px"></div>
        </div>
        <div class="dev-ie-field"><label>基础调查文本</label><textarea id="f-inspectText" class="dev-textarea" rows="2"></textarea></div>
        <div class="dev-ie-field" style="flex:0"><label>调查推进时间（分钟，全局）</label>
          <input type="number" id="f-inspectTimeAdv" value="0" min="0" style="width:90px" oninput="_ie._setDirty()"></div>
      </div>
      <div class="dev-section dev-ie-sec"><h3>📍 位置</h3>
        <div id="ie-loc-tags" class="dev-ie-tags"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">
          <select id="ie-loc-picker" style="flex:1;min-width:160px;min-height:23px;border:2px inset #eee;padding:1px 3px;font-size:12px"
            onchange="_ie._onLocPick()">
            <option value="">── 从位置列表选择 ──</option>
          </select>
        </div>
        <div style="display:flex;gap:6px">
          <input type="text" id="ie-loc-input" placeholder="dorm / ajie_desk …" style="flex:1;min-height:23px;border:2px inset #eee;padding:2px 4px"
            onkeydown="if(event.key==='Enter')_ie._addLocTag()">
          <button type="button" class="win95-btn dev-btn" onclick="_ie._addLocTag()">添加</button>
          <button type="button" class="win95-btn dev-btn" onclick="_ie._clearLoc()">清空</button>
        </div>
      </div>
      <div class="dev-section dev-ie-sec"><h3>🏷 属性</h3>
        <div style="display:flex;flex-wrap:wrap;gap:12px">
          <label><input type="checkbox" id="f-pickable" onchange="_ie._renderFlags()"> 可拾取</label>
          <label><input type="checkbox" id="f-usable" onchange="_ie._renderFlags()"> 可使用</label>
          <label><input type="checkbox" id="f-consumable"> 使用消耗</label>
          <label><input type="checkbox" id="f-isBook" onchange="_ie._renderFlags()"> 书籍</label>
        </div>
      </div>
      <div class="dev-section dev-ie-sec"><h3>🧠 SAN 变体</h3>
        <div id="ie-san-tabs" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px"></div>
        <div id="ie-san-panel"></div>
      </div>
      <div class="dev-section dev-ie-sec"><h3>🔑 全局调查关键词</h3>
        <div id="ie-kw-tags" class="dev-ie-tags"></div>
        <div style="display:flex;gap:6px">
          <input type="text" id="ie-kw-input" placeholder="keyword_id" style="flex:1;min-height:23px;border:2px inset #eee;padding:2px 4px"
            onkeydown="if(event.key==='Enter')_ie._addKwTag()">
          <button type="button" class="win95-btn dev-btn" onclick="_ie._addKwTag()">添加</button>
        </div>
      </div>
      <div class="dev-section dev-ie-sec"><h3>🔎 调查日程</h3><p style="font-size:11px;color:#888">直接编辑当前物品的 investigate 内嵌日程；保存蓝图后会写回物品草稿。</p>
        <div id="ie-investigate-editor" class="dev-ie-investigate-editor"></div>
      </div>
      <div class="dev-section dev-ie-sec" id="ie-sec-use" style="display:none"><h3>⚡ 使用日程</h3>
        <p style="font-size:11px;color:#888">直接编辑当前物品的 use 内嵌日程；保存蓝图后会写回物品草稿。</p>
        <div class="dev-ie-row">
          <div class="dev-ie-field" style="flex:0"><label>SAN 最低（0=不限）</label><input type="number" id="f-sanMin" value="0" min="0" max="100" style="width:70px" oninput="_ie._setDirty()"></div>
          <div class="dev-ie-field" style="flex:0"><label>SAN 最高（0=不限）</label><input type="number" id="f-sanMax" value="0" min="0" max="100" style="width:70px" oninput="_ie._setDirty()"></div>
          <div style="flex:1;padding-top:18px;font-size:11px;color:#888">书籍填 1/50 表示仅 0&lt;SAN≤50 时可用</div>
        </div>
        <div id="ie-use-editor" class="dev-ie-item-schedule-editor"></div>
      </div>
      <div class="dev-section dev-ie-sec" id="ie-sec-book" style="display:none"><h3>📖 书籍内容</h3>
        <div id="ie-book-entries"></div>
        <button type="button" class="win95-btn dev-btn" style="margin-top:4px" onclick="_ie._addBookEntry()">＋ 添加</button>
        <p style="font-size:11px;color:#888;margin-top:4px">提示：请由开发者手动填写内容。</p>
      </div>
      <div class="dev-section dev-ie-sec" id="ie-sec-spells" style="display:none"><h3>✨ 可学习法术</h3>
        <p style="font-size:11px;color:#888;margin-bottom:6px">0&lt;SAN≤50 时使用此书可学习；学习 4h；施放 5 SAN</p>
        <div id="ie-spell-entries"></div>
        <button type="button" class="win95-btn dev-btn" style="margin-top:4px" onclick="_ie._addSpell()">＋ 添加法术</button>
      </div>
      <div style="display:flex;gap:8px;padding:8px 0 4px">
        <button type="button" class="win95-btn dev-btn" onclick="_ie.saveItem()">💾 保存物品</button>
        <button type="button" class="win95-btn dev-btn" onclick="_ie.deleteItem()">🗑 删除</button>
        <span id="ie-save-msg" style="font-size:12px;color:#388e3c;margin-left:8px"></span>
      </div>
    </div>
  </section>
</div>
<div id="ie-spell-main" class="dev-ie-main" style="display:none">
  <aside class="dev-ie-sidebar">
    <div class="dev-ie-sidebar-hd"><input id="ie-spell-search" placeholder="搜索法术名称/ID…" oninput="_ie._renderSpellList()"><button type="button" class="win95-btn dev-btn" onclick="_ie._addStandaloneSpell()">＋</button></div>
    <div id="ie-spell-list" class="dev-ie-item-list"></div>
  </aside>
  <section class="dev-ie-editor"><div id="ie-spell-empty" style="color:#aaa;padding:40px;text-align:center">← 选择法术或点击 ＋ 新建</div><div id="ie-spell-form" style="display:none;padding:10px"></div></section>
</div>
</div>`;
  }

  // ── list ─────────────────────────────────────────────────────────────────
  _renderList() {
    const el = this._el('ie-item-list'); if (!el) return;
    const q = (this._el('ie-search')?.value||'').toLowerCase();
    el.innerHTML = this.items
      .filter(it=>!q||it.id.includes(q)||it.defaultName.toLowerCase().includes(q))
      .map(it=>{
        const flags=[it.pickable?'拾':'',it.usable?'用':'',it.isBook?'书':''].filter(Boolean).join('/');
        const loc=it.locations.length?it.locations.join('→'):'（无位置）';
        return `<div class="dev-ie-item-row${it.id===this.currentId?' active':''}" onclick="_ie._selectItem('${it.id}')">
          <div style="flex:1;overflow:hidden"><div style="font-weight:600">${this._e(it.defaultName)||'(未命名)'}</div>
          <div style="font-size:10px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._e(loc)}</div></div>
          ${flags?`<div style="font-size:10px;color:#999;margin-left:auto">${flags}</div>`:''}
        </div>`;
      }).join('')||'<div style="padding:16px;color:#aaa;text-align:center;font-size:12px">暂无物品</div>';
  }

  _switchTab(tab) {
    this.activeTab = tab;
    const items = this._el('ie-item-main'), spells = this._el('ie-spell-main');
    if (items) items.style.display = tab === 'items' ? '' : 'none';
    if (spells) spells.style.display = tab === 'spells' ? '' : 'none';
    if (tab === 'spells') this._renderSpellList();
  }

  _allSpells() {
    return this.items.flatMap((item) => (item.spells || []).map((spell, index) => ({
      item, spell, index, key: `${item.id}__${index}`,
      id: spell.id || `${item.id}__${index}`,
    })));
  }

  _renderSpellList() {
    const el = this._el('ie-spell-list'); if (!el) return;
    const query = (this._el('ie-spell-search')?.value || '').toLowerCase();
    const rows = this._allSpells().filter(({ item, spell, id }) =>
      !query || id.toLowerCase().includes(query) || String(spell.name || '').toLowerCase().includes(query));
    el.innerHTML = rows.map(({ item, spell, key, id }) =>
      `<div class="dev-ie-item-row${key === this.currentSpellKey ? ' active' : ''}" onclick="_ie._selectSpell('${this._e(key)}')">
        <div style="flex:1;overflow:hidden"><div style="font-weight:600">${this._e(spell.name) || '(未命名法术)'}</div>
        <div style="font-size:10px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._e(id)} · ${this._e(item.defaultName)}</div></div>
      </div>`).join('') || '<div style="padding:16px;color:#aaa;text-align:center;font-size:12px">暂无法术</div>';
  }

  _selectSpell(key) {
    this.currentSpellKey = key;
    this._renderSpellForm();
    this._renderSpellList();
  }

  _spellRecord() { return this._allSpells().find((entry) => entry.key === this.currentSpellKey) || null; }

  _addStandaloneSpell() {
    let item = this.items.find((entry) => entry.id === 'dev_spells') || this.items[0];
    if (!item) { this.addItem(); item = this.items.find((entry) => entry.id === this.currentId); }
    if (!item.spells) item.spells = [];
    item.spells.push({ name: '', description: '', learnTimeMinutes: 240, castSanCost: 5 });
    this.currentSpellKey = `${item.id}__${item.spells.length - 1}`;
    this.dirty = true; this._renderSpellList(); this._renderSpellForm();
  }

  _renderSpellForm() {
    const empty = this._el('ie-spell-empty'), form = this._el('ie-spell-form'), record = this._spellRecord();
    if (!empty || !form) return;
    if (!record) { empty.style.display = ''; form.style.display = 'none'; return; }
    empty.style.display = 'none'; form.style.display = '';
    const { spell, item, index, id } = record;
    form.innerHTML = `<div class="dev-section dev-ie-sec"><h3>✨ 法术基本信息</h3>
      <div class="dev-ie-field"><label>法术 ID（由宿主物品和序号稳定生成）</label><input type="text" value="${this._e(id)}" disabled></div>
      <div class="dev-ie-field"><label>宿主物品</label><div>${this._e(item.defaultName)}（${this._e(item.id)}）</div></div>
      <div class="dev-ie-field"><label>名称</label><input id="ie-spell-name" value="${this._e(spell.name)}" oninput="_ie._spellField('name',this.value)"></div>
      <div class="dev-ie-field"><label>效果描述</label><textarea id="ie-spell-desc" class="dev-textarea" rows="4" oninput="_ie._spellField('description',this.value)">${this._e(spell.description)}</textarea></div>
      <div class="dev-ie-row"><div class="dev-ie-field"><label>学习时间（分钟）</label><input type="number" min="0" value="${Number(spell.learnTimeMinutes || 240)}" oninput="_ie._spellField('learnTimeMinutes',this.value)"></div>
      <div class="dev-ie-field"><label>施放 SAN 消耗</label><input type="number" min="0" value="${Number(spell.castSanCost || 5)}" oninput="_ie._spellField('castSanCost',this.value)"></div></div>
      </div>`;
  }

  _spellField(field, value) {
    const record = this._spellRecord(); if (!record) return;
    record.spell[field] = ['learnTimeMinutes', 'castSanCost'].includes(field) ? (parseInt(value, 10) || 0) : value;
    this.dirty = true; if (field === 'name') this._renderSpellList();
  }

  _defaultSchedule() {
    const blueprint = createEmptyBlueprint();
    blueprint.nodes.end = { id: 'end', type: 'scheduleEnd', inputs: {}, outputs: {}, x: 280, y: 80 };
    blueprint.connections.push({ fromNodeId: 'start', fromPort: 'flowOut', toNodeId: 'end', toPort: 'flowIn' });
    return blueprint;
  }

  _defaultInvestigateSchedule() {
    return this._defaultSchedule();
  }

  _unmountInvestigateEditor() {
    if (this._investigateEditor) this._investigateEditor.unmount();
    if (this._useEditor) this._useEditor.unmount();
    this._investigateEditor = null;
    this._investigateEditorHost = null;
    this._useEditor = null;
    this._useEditorHost = null;
  }

  _mountItemScheduleEditor(item, action) {
    const host = this._el(action === 'investigate' ? 'ie-investigate-editor' : 'ie-use-editor');
    const editorKey = action === 'investigate' ? '_investigateEditor' : '_useEditor';
    const hostKey = action === 'investigate' ? '_investigateEditorHost' : '_useEditorHost';
    if (!host || !item) return;
    if (this[hostKey] === item && this[editorKey]) return;
    if (this[editorKey]) this[editorKey].unmount();
    item.schedules ||= {};
    item.schedules[action] ||= this._defaultSchedule();
    const project = {
      version: 2, totalDays: 1, customVars: [],
      schedules: { embedded: { displayName: action, entries: [{
        id: action, name: action,
        dialogueTree: JSON.parse(JSON.stringify(item.schedules[action])),
      }] } },
      events: {}, endings: {}, eventFileDoc: { events: [] }, endingFileDoc: { endings: [] },
    };
    const editor = new DevDialogueEditorTab(this._dev, {
      workspace: false,
      project,
      initialCtx: { type: 'schedule', id: 'embedded', entryIndex: 0 },
      embeddedScope: {
        title: `${item.defaultName || item.id} · ${action}`,
        onSave: (blueprint) => {
          item.schedules[action] = JSON.parse(JSON.stringify(blueprint));
          this.dirty = true;
          this._persist();
        },
      },
    });
    host.replaceChildren();
    host.append(document.createRange().createContextualFragment(editor.html()));
    editor.mount(host.querySelector('.dev-de-root'));
    this[editorKey] = editor;
    this[hostKey] = item;
  }

  _mountInvestigateEditor(item) { this._mountItemScheduleEditor(item, 'investigate'); }
  _mountUseEditor(item) { this._mountItemScheduleEditor(item, 'use'); }

  unmount() {
    this._unmountInvestigateEditor();
  }

  _selectItem(id, skipSave) {
    if (this.currentId&&this.dirty&&!skipSave) this.saveItem(true);
    this.currentId=id; this.activeSanKey='>90'; this._selectedSanImageKeys.clear(); this.dirty=false;
    this._loadForm(); this._renderList();
  }

  addItem() {
    if (this.currentId&&this.dirty) this.saveItem(true);
    const it=this._emptyItem(); this.items.push(it);
    this.currentId=it.id; this.activeSanKey='>90'; this._selectedSanImageKeys.clear(); this.dirty=false;
    this._loadForm(); this._renderList();
  }

  // ── form ─────────────────────────────────────────────────────────────────
  _loadForm() {
    const it=this.items.find(i=>i.id===this.currentId);
    if (!it) { this._el('ie-editor-empty').style.display=''; this._el('ie-editor-form').style.display='none'; return; }
    this._el('ie-editor-empty').style.display='none'; this._el('ie-editor-form').style.display='';
    this._el('f-id').value=it.id; this._el('f-defaultName').value=it.defaultName;
    this._el('f-worldCount').value=it.worldCount; this._el('f-inspectText').value=it.inspectText;
    this._el('f-pickable').checked=it.pickable; this._el('f-usable').checked=it.usable;
    this._el('f-consumable').checked=it.consumable; this._el('f-isBook').checked=it.isBook;
    this._el('f-inspectTimeAdv').value=it.inspectTimeAdvance||0;
    this._el('f-sanMin').value=(it.useCondition&&it.useCondition.sanMin)||0;
    this._el('f-sanMax').value=(it.useCondition&&it.useCondition.sanMax)||0;

    this._renderLocTags(); this._renderKwTags(); this._renderFlags();
    this._renderSanTabs(); this._renderSanPanel(); this._renderBookEntries(); this._renderSpells();
    this._mountInvestigateEditor(it);
    this._mountUseEditor(it);
    const sm=this._el('ie-save-msg'); if(sm) sm.textContent='';
  }

  _setDirty() { this.dirty=true; }
  _onNameInput() { this.dirty=true; this._renderList(); }

  // ── location picker (populated from LocationSystem) ──────────────────────
  async _loadLocationPicker() {
    try {
      await locationSystem.load();
      const sel = this._el('ie-loc-picker');
      if (!sel) return;
      sel.innerHTML = '<option value="">── 从位置列表选择 ──</option>' +
        locationSystem.allKeys().map(({ key, label }) =>
          `<option value="${this._e(key)}">${this._e(label)}</option>`
        ).join('');
    } catch (_) { /* locationSystem not loaded yet, manual input still works */ }
  }
  _onLocPick() {
    const sel = this._el('ie-loc-picker');
    const v = sel?.value; if (!v) return;
    const inp = this._el('ie-loc-input'); if (inp) inp.value = v;
    this._addLocTag();
    if (sel) sel.value = '';
  }

  // ── location tags ─────────────────────────────────────────────────────────
  _renderLocTags() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    this._el('ie-loc-tags').innerHTML=it.locations.map((l,i)=>
      `<span class="dev-ie-tag">${this._e(l)}<button type="button" onclick="_ie._removeLocTag(${i})">✕</button></span>`).join('');
  }
  _addLocTag() {
    const inp=this._el('ie-loc-input'); const v=inp?.value.trim(); if(!v) return;
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    it.locations.push(v); inp.value=''; this._renderLocTags(); this.dirty=true;
  }
  _removeLocTag(i) { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; it.locations.splice(i,1); this._renderLocTags(); this.dirty=true; }
  _clearLoc() { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; it.locations=[]; this._renderLocTags(); this.dirty=true; }

  // ── keyword tags ──────────────────────────────────────────────────────────
  _renderKwTags() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    this._el('ie-kw-tags').innerHTML=(it.revealKeywordIds||[]).map((k,i)=>
      `<span class="dev-ie-tag kw">${this._e(k)}<button type="button" onclick="_ie._removeKwTag(${i})">✕</button></span>`).join('');
  }
  _addKwTag() {
    const inp=this._el('ie-kw-input'); const v=inp?.value.trim(); if(!v) return;
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    if(!it.revealKeywordIds) it.revealKeywordIds=[];
    if(!it.revealKeywordIds.includes(v)) it.revealKeywordIds.push(v);
    inp.value=''; this._renderKwTags(); this.dirty=true;
  }
  _removeKwTag(i) { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; it.revealKeywordIds.splice(i,1); this._renderKwTags(); this.dirty=true; }

  // ── flags / section visibility ───────────────────────────────────────────
  _renderFlags() {
    const u=this._vc('f-usable'), b=this._vc('f-isBook');
    const su=this._el('ie-sec-use'), sb=this._el('ie-sec-book'), ss=this._el('ie-sec-spells');
    if(su) su.style.display=u?'':'none';
    if(sb) sb.style.display=b?'':'none';
    if(ss) ss.style.display=(u&&b)?'':'none';
  }

  // ── SAN tabs / panel ─────────────────────────────────────────────────────
  _renderSanTabs() {
    const el=this._el('ie-san-tabs'); if(!el) return;
    el.innerHTML=_IE_BANDS.map(b=>
      `<span style="display:inline-flex;align-items:center;gap:2px">
        <input type="checkbox" title="上传图片时同时应用到此 SAN 变体" ${this._selectedSanImageKeys.has(b.key)?'checked':''}
          ${b.key==='=0'?'disabled':''} onchange="_ie._toggleSanImageTarget('${b.key}',this.checked)">
        <button type="button" class="win95-btn dev-btn"
          style="${this.activeSanKey===b.key?'background:'+b.color+';color:#fff':''}"
          onclick="_ie._switchSanTab('${b.key}')">${this._e(b.label)}</button>
      </span>`
    ).join('');
  }
  _toggleSanImageTarget(key, checked) {
    if (key === '=0') return;
    if (checked) this._selectedSanImageKeys.add(key);
    else this._selectedSanImageKeys.delete(key);
    this._renderSanTabs();
  }
  _switchSanTab(key) { this.activeSanKey=key; this._renderSanTabs(); this._renderSanPanel(); }

  _renderSanPanel() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const v=it.sanVariants[this.activeSanKey]||{name:'',description:'',image:'',revealKeywordIds:[],inspEffect:{gameEvent:'',mental:0,ending:''}};
    if(!v.inspEffect) v.inspEffect={gameEvent:'',mental:0,ending:''};
    const band=_IE_BANDS.find(b=>b.key===this.activeSanKey);
    const isZeroSan=this.activeSanKey==='=0';
    const imageValue=isZeroSan ? (it.sanVariants['>90']?.image||'') : (v.image||'');
    const imageSrc=this._imageSrc(imageValue);
    const imgHTML=imageSrc
      ?`<img style="width:96px;height:96px;border:1px solid #ccc;object-fit:contain;background:#f9f9f9" src="${this._e(imageSrc)}" id="ie-sp-img" alt="图片预览" onerror="this.alt='图片加载失败'">`
      :`<div style="width:64px;height:64px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:10px" id="ie-sp-img">无图片</div>`;
    const kwHTML=(v.revealKeywordIds||[]).map((k,i)=>
      `<span class="dev-ie-tag kw">${this._e(k)}<button type="button" onclick="_ie._removeSanKwTag(${i})">✕</button></span>`
    ).join('');
    const panel=this._el('ie-san-panel'); if(!panel) return;
    panel.innerHTML=`
      <div style="color:${band.color};font-weight:600;margin-bottom:6px;font-size:12px">${this._e(band.label)} 时的表现</div>
      <div class="dev-ie-field"><label>名称（留空=默认）</label>
        <input type="text" id="ie-sp-name" value="${this._e(v.name)}" oninput="_ie._sanInput()"></div>
      <div class="dev-ie-field"><label>${this.activeSanKey === '=0' ? 'SAN=0 调查文字（图片沿用 SAN=100）' : '调查描述（留空=基础文本）'}</label>
        <textarea id="ie-sp-desc" class="dev-textarea" rows="3" oninput="_ie._sanInput()">${this._e(v.description)}</textarea></div>
      <div class="dev-ie-field"><label>此段专属关键词</label>
        <div id="ie-sp-kw-tags" class="dev-ie-tags">${kwHTML}</div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input type="text" id="ie-sp-kw-input" placeholder="keyword_id" style="flex:1;min-height:23px;border:2px inset #eee;padding:2px 4px"
            onkeydown="if(event.key==='Enter')_ie._addSanKwTag()">
          <button type="button" class="win95-btn dev-btn" onclick="_ie._addSanKwTag()">添加</button>
        </div></div>
      <details style="margin:6px 0"><summary style="cursor:pointer;font-size:12px;font-weight:600;color:#555">🔍 本段调查效果</summary>
        <div style="display:flex;flex-wrap:wrap;gap:10px;padding-top:8px">
          <div class="dev-ie-field" style="min-width:100px"><label>SAN 变化</label>
            <input type="number" id="ie-sp-insp-mental" value="${v.inspEffect.mental||0}" oninput="_ie._sanInspInput()"></div>
          <div class="dev-ie-field" style="flex:1;min-width:140px"><label>触发游戏事件</label>
            <input type="text" id="ie-sp-insp-event" value="${this._e(v.inspEffect.gameEvent||'')}" oninput="_ie._sanInspInput()"></div>
          <div class="dev-ie-field" style="flex:1;min-width:140px"><label>触发结局</label>
            <input type="text" id="ie-sp-insp-ending" value="${this._e(v.inspEffect.ending||'')}" oninput="_ie._sanInspInput()"></div>
        </div></details>
      <div class="dev-ie-field"><label>${isZeroSan ? 'SAN=0 图片（自动沿用 SAN=100）' : '外观图片地址'}</label>
        <div style="display:flex;gap:10px;align-items:flex-start">
          ${imgHTML}
          <div style="display:flex;flex-direction:column;gap:5px;flex:1">
            <div style="display:flex;gap:5px;align-items:center">
              <select id="ie-sp-image-picker" onchange="_ie._selectSanImage(this.value)" style="max-width:260px" ${isZeroSan?'disabled':''}>
                <option value="">── 从 data/assets 选择 ──</option>
                ${this._assetPaths().map((path) => `<option value="${this._e(path)}" ${path === imageValue ? 'selected' : ''}>${this._e(path)}</option>`).join('')}
              </select>
              <input type="text" id="ie-sp-image" value="${this._e(imageValue)}" placeholder="data/assets/item_xxx.png" oninput="_ie._sanImageInput()" style="flex:1;min-width:0" ${isZeroSan?'disabled':''}>
            </div>
            <span style="font-size:11px;color:#888">选择已登记的 data/assets 图片，或直接填写资源路径。</span>
          </div>
        </div>
      </div>`;
  }

  _selectSanImage(value) {
    const it = this.items.find(i => i.id === this.currentId);
    if (!it || this.activeSanKey === '=0') return;
    const selected = [...this._selectedSanImageKeys].filter((key) => key !== '=0' && it.sanVariants[key]);
    const targets = selected.length ? selected : [this.activeSanKey];
    targets.forEach((key) => { it.sanVariants[key].image = String(value || '').trim(); });
    this.dirty = true;
    this._renderSanPanel();
  }

  _sanInput() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const sv=it.sanVariants[this.activeSanKey];
    const n=this._el('ie-sp-name'), d=this._el('ie-sp-desc');
    if(n) sv.name=n.value; if(d) sv.description=d.value; this.dirty=true;
  }
  _sanImageInput() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const sv=it.sanVariants[this.activeSanKey];
    sv.image=this._v('ie-sp-image').trim();
    this.dirty=true;
    this._renderSanPanel();
    const input=this._el('ie-sp-image'); if(input) { input.focus(); input.selectionStart=input.selectionEnd=input.value.length; }
  }
  _sanInspInput() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const sv=it.sanVariants[this.activeSanKey];
    if(!sv.inspEffect) sv.inspEffect={gameEvent:'',mental:0,ending:''};
    const m=this._el('ie-sp-insp-mental'), ev=this._el('ie-sp-insp-event'), en=this._el('ie-sp-insp-ending');
    if(m) sv.inspEffect.mental=parseInt(m.value)||0;
    if(ev) sv.inspEffect.gameEvent=ev.value;
    if(en) sv.inspEffect.ending=en.value;
    this.dirty=true;
  }

  _addSanKwTag() {
    const inp=this._el('ie-sp-kw-input'); if(!inp) return;
    const v=inp.value.trim(); if(!v) return;
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const sv=it.sanVariants[this.activeSanKey];
    if(!sv.revealKeywordIds) sv.revealKeywordIds=[];
    if(!sv.revealKeywordIds.includes(v)) sv.revealKeywordIds.push(v);
    inp.value=''; this._renderSanPanel(); this.dirty=true;
  }
  _removeSanKwTag(i) {
    const it=this.items.find(x=>x.id===this.currentId); if(!it) return;
    it.sanVariants[this.activeSanKey].revealKeywordIds.splice(i,1);
    this._renderSanPanel(); this.dirty=true;
  }

  // ── book entries ──────────────────────────────────────────────────────────
  _renderBookEntries() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const el=this._el('ie-book-entries'); if(!el) return;
    el.innerHTML=it.bookContents.map((c,i)=>
      `<div style="display:flex;gap:6px;margin-bottom:6px;align-items:flex-start">
        <span style="font-size:12px;color:#999;min-width:18px;padding-top:6px">${i+1}.</span>
        <textarea class="dev-textarea" rows="2" style="flex:1" oninput="_ie._bookInput(${i},this.value)">${this._e(c)}</textarea>
        <button type="button" class="win95-btn dev-btn" onclick="_ie._removeBookEntry(${i})">✕</button>
      </div>`
    ).join('');
  }
  _addBookEntry() { const it=this.items.find(i=>i.id===this.currentId); if(!it) return; it.bookContents.push(''); this._renderBookEntries(); this.dirty=true; }
  _removeBookEntry(i) { const it=this.items.find(i=>i.id===this.currentId); if(!it) return; it.bookContents.splice(i,1); this._renderBookEntries(); this.dirty=true; }
  _bookInput(i,v) { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; it.bookContents[i]=v; this.dirty=true; }

  // ── spells ────────────────────────────────────────────────────────────────
  _renderSpells() {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    const el=this._el('ie-spell-entries'); if(!el) return;
    el.innerHTML=(it.spells||[]).map((s,i)=>
      `<div style="display:flex;gap:6px;margin-bottom:8px;align-items:flex-start">
        <span style="font-size:12px;color:#999;min-width:18px;padding-top:6px">${i+1}.</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          <input type="text" placeholder="法术名称" value="${this._e(s.name)}" style="min-height:23px;border:2px inset #eee;padding:2px 4px"
            oninput="_ie._spellInput(${i},'name',this.value)">
          <textarea class="dev-textarea" rows="2" placeholder="效果描述" oninput="_ie._spellInput(${i},'description',this.value)">${this._e(s.description)}</textarea>
        </div>
        <div style="font-size:11px;color:#888;padding-top:6px;white-space:nowrap;text-align:center;min-width:44px">
          <div>⏱ 4h</div><div>💀 5 SAN</div>
        </div>
        <button type="button" class="win95-btn dev-btn" onclick="_ie._removeSpell(${i})">✕</button>
      </div>`
    ).join('')||'<div style="color:#aaa;font-size:12px;padding:4px 0">尚未添加法术</div>';
  }
  _addSpell() { const it=this.items.find(i=>i.id===this.currentId); if(!it) return; if(!it.spells) it.spells=[]; it.spells.push({name:'',description:''}); this._renderSpells(); this.dirty=true; }
  _removeSpell(i) { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; it.spells.splice(i,1); this._renderSpells(); this.dirty=true; }
  _spellInput(i,field,val) { const it=this.items.find(x=>x.id===this.currentId); if(!it) return; if(it.spells&&it.spells[i]) it.spells[i][field]=val; this.dirty=true; }

  // ── save / delete ─────────────────────────────────────────────────────────
  saveItem(silent) {
    const it=this.items.find(i=>i.id===this.currentId); if(!it) return;
    it.id=this._el('f-id')?.value.trim()||it.id;
    it.defaultName=this._v('f-defaultName'); it.worldCount=this._vi('f-worldCount');
    it.inspectText=this._v('f-inspectText'); it.pickable=this._vc('f-pickable');
    it.usable=this._vc('f-usable'); it.consumable=this._vc('f-consumable'); it.isBook=this._vc('f-isBook');
    it.inspectTimeAdvance=this._vi('f-inspectTimeAdv');
    it.useCondition={sanMin:this._vi('f-sanMin'),sanMax:this._vi('f-sanMax')};
    it.schedules ||= {};
    it.schedules.use ||= this._defaultSchedule();
    this.currentId=it.id; this.dirty=false; this._persist();
    if(!silent){const sm=this._el('ie-save-msg');if(sm){sm.textContent='✓ 已保存';setTimeout(()=>{sm.textContent='';},2000);}}
    this._renderList();
  }
  deleteItem() {
    if(!this.currentId||!confirm('确认删除？')) return;
    this._unmountInvestigateEditor();
    this.items=this.items.filter(i=>i.id!==this.currentId);
    this.currentId=null; this.dirty=false; this._persist();
    const ef=this._el('ie-editor-empty'), ff=this._el('ie-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
    this._renderList();
  }

  // ── persistence / import / export ─────────────────────────────────────────
  _persist() {
    try{ localStorage.setItem(_IE_LS, JSON.stringify({_editorFormat:true,items:this.items})); }catch(e){}
  }
  _loadLS() {
    try{
      const raw=localStorage.getItem(_IE_LS); if(!raw) return false;
      const d=JSON.parse(raw);
      if(d._editorFormat&&Array.isArray(d.items)){this.items=d.items;return true;}
    }catch(e){}
    return false;
  }

  importJSON() { this._el('ie-file-input')?.click(); }
  async _loadCurrentGame(initialItemId = null) {
    try {
      const data = await dataLoader.loadJSON('items.json');
      if (!Array.isArray(data.items)) throw new Error('items.json 缺少 items 数组');
      if (data.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('items.json 的 items 必须全部是 JSON 对象');
      }
      this.items = data.items.map(g=>this._fromGame(g));
      this.currentId = initialItemId && this.items.some((item) => item.id === initialItemId) ? initialItemId : null;
      this.dirty=false; this._persist(); this._renderList(); this._loadForm();
      const imageCount=this.items.reduce((n,item)=>n+        +Object.values(item.sanVariants||{}).filter(v=>typeof v.image==='string'&&v.image.trim()).length,0);
      this._st('已从当前游戏读取 items.json：'+this.items.length+' 个物品，图片路径 '+imageCount+' 条');
    } catch (err) { this._st('读取当前游戏失败：'+err.message); }
  }
  _onFile(ev) {
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{
      try{
        const data=JSON.parse(e.target.result);
        if(data._editorFormat) this.items=data.items;
        else if(data.items) this.items=data.items.map(g=>this._fromGame(g));
        else{alert('无法识别格式');return;}
        this.currentId=null; this.dirty=false; this._persist(); this._renderList();
        this._st('导入成功：'+this.items.length+' 个物品');
      }catch(err){alert('JSON 解析失败：'+err.message);}
    };
    r.readAsText(f,'utf-8'); ev.target.value='';
  }
  exportJSON() {
    if(this.currentId&&this.dirty) this.saveItem(true);
    const blob=new Blob([JSON.stringify({items:this.items.map(it=>this._toGame(it))},null,2)+'\n'],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='items.json'; a.click(); URL.revokeObjectURL(a.href);
    this._st('items.json 已下载');
  }
  async writeToGame() {
    if(this.currentId&&this.dirty) this.saveItem(true);
    const gameData={items:this.items.map(it=>this._toGame(it))};
    const ok=await this._dev.writeToDisk('items.json',gameData);
    if(ok) this._st('items.json 已写入磁盘');
  }

  // ── format converters ─────────────────────────────────────────────────────
  _toGame(it) {
    // Spread rawGame first so unmanaged fields (inspectCheck, inspectOutcomes,
    // Legacy use-effect fields are intentionally omitted; effects now live in schedules.use.
    const out = it._rawGame ? {...it._rawGame} : {};
    // Overwrite every managed field unconditionally, and delete it when cleared.
    out.id=it.id; out.name=it.defaultName; out.consumable=it.consumable;
    out.usable=it.usable; out.pickable=it.pickable;
    out.worldCount=it.worldCount; out.locations=it.locations;
    if(it.inspectText) out.inspectText=it.inspectText; else delete out.inspectText;
    if(it.inspectTimeAdvance) out.inspectTimeAdvance=it.inspectTimeAdvance; else delete out.inspectTimeAdvance;
    const uc=it.useCondition||{};
    if(uc.sanMin||uc.sanMax){out.useCondition={};if(uc.sanMin)out.useCondition.sanMin=uc.sanMin;if(uc.sanMax)out.useCondition.sanMax=uc.sanMax;} else delete out.useCondition;
    if(it.revealKeywordIds&&it.revealKeywordIds.length) out.revealKeywordIds=it.revealKeywordIds; else delete out.revealKeywordIds;
    const variants={};
    _IE_BANDS.forEach(b=>{
      const v=it.sanVariants[b.key]||{}; const entry={};
      if(v.name) entry.name=v.name; if(v.description) entry.description=v.description;
      if(v.image) entry.image=v.image;
      if(v.revealKeywordIds&&v.revealKeywordIds.length) entry.revealKeywordIds=v.revealKeywordIds;
      const ie=v.inspEffect||{};
      if(ie.gameEvent||ie.mental||ie.ending){entry.inspectEffect={};if(ie.gameEvent)entry.inspectEffect.gameEvent=ie.gameEvent;if(ie.mental)entry.inspectEffect.statChanges={mental:ie.mental};if(ie.ending)entry.inspectEffect.ending=ie.ending;}
      if(Object.keys(entry).length) variants[b.key]=entry;
    });
    if(Object.keys(variants).length) out.sanVariants=variants; else delete out.sanVariants;
    if(it.isBook) out.isBook=true; else delete out.isBook;
    if(it.bookContents&&it.bookContents.length) out.bookContents=it.bookContents; else delete out.bookContents;
    if(it.spells&&it.spells.length) out.spells=it.spells.filter(s=>s.name).map(s=>{ const spell={...s,name:s.name,description:s.description||'',learnTimeMinutes:Number(s.learnTimeMinutes||240),castSanCost:Number(s.castSanCost||5)}; return spell; }); else delete out.spells;
    if(it.schedules && Object.keys(it.schedules).length) {
      out.schedules=JSON.parse(JSON.stringify(it.schedules));
      const resultNode=out.schedules.investigate?.nodes?.["band6:result"];
      const san0Text=it.sanVariants['=0']?.description;
      if(resultNode && san0Text) resultNode.inputs ||= {}, resultNode.inputs.text=san0Text;
      _IE_BANDS.forEach((b,index)=>{
        const imageNode=out.schedules.investigate?.nodes?.[`band${index}:image`];
        const image=it.sanVariants[b.key]?.image;
        if(imageNode && image) imageNode.inputs ||= {}, imageNode.inputs.image=image;
      });
      const normalImage=out.schedules.investigate?.nodes?.['band0:image']?.inputs?.image;
      const zeroImage=out.schedules.investigate?.nodes?.['band6:image'];
      if(normalImage && zeroImage) zeroImage.inputs ||= {}, zeroImage.inputs.image=normalImage;
    } else delete out.schedules;
    delete out.useEffect; delete out.successMessage; delete out.failMessage;
    return out;
  }
  _fromGame(g) {
    const it=this._emptyItem();
    it._rawGame=g; // preserve unknown fields (for lossless round-trip)
    it.id=g.id||it.id; it.defaultName=g.name||''; it.consumable=!!g.consumable;
    it.usable=!!g.usable; it.pickable=!!g.pickable; it.worldCount=g.worldCount||1;
    it.locations=g.locations||[]; it.inspectText=g.inspectText||'';
    it.inspectTimeAdvance=g.inspectTimeAdvance||0; it.isBook=!!g.isBook;
    it.useCondition={sanMin:(g.useCondition&&g.useCondition.sanMin)||0,sanMax:(g.useCondition&&g.useCondition.sanMax)||0};
    it.bookContents=g.bookContents||[];
    it.spells=(g.spells||[]).map(s=>({ ...s, name:s.name||'', description:s.description||'', learnTimeMinutes:Number(s.learnTimeMinutes||240), castSanCost:Number(s.castSanCost||5), schedules:s.schedules ? JSON.parse(JSON.stringify(s.schedules)) : {} }));
    it.schedules=g.schedules ? JSON.parse(JSON.stringify(g.schedules)) : {};
    it.revealKeywordIds=g.revealKeywordIds||[];
    const san0Result=it.schedules.investigate?.nodes?.["band6:result"]?.inputs?.text;
    if(san0Result !== undefined) it.sanVariants['=0'].description=String(san0Result);
    _IE_BANDS.forEach((b,index)=>{
      const image=it.schedules.investigate?.nodes?.[`band${index}:image`]?.inputs?.image;
      if(image !== undefined && !it.sanVariants[b.key].image) it.sanVariants[b.key].image=String(image);
    });
    if(it.sanVariants['>90'].image) it.sanVariants['=0'].image=it.sanVariants['>90'].image;
    const topIE=g.inspectEffect||null;
    const readIE=src=>({gameEvent:src.gameEvent||'',mental:(src.statChanges&&src.statChanges.mental)||0,ending:src.ending||''});
    if(g.sanVariants){_IE_BANDS.forEach(b=>{const src=g.sanVariants[b.key];const dst=it.sanVariants[b.key];if(src){if(src.name!==undefined)dst.name=src.name;if(src.description!==undefined)dst.description=src.description;const image=src.image??src.imagePath??src.imageUrl;if(image!==undefined)dst.image=String(image);if(src.revealKeywordIds)dst.revealKeywordIds=[...src.revealKeywordIds];if(src.inspectEffect)dst.inspEffect=readIE(src.inspectEffect);else if(topIE)dst.inspEffect=readIE(topIE);}else if(topIE){dst.inspEffect=readIE(topIE);}});}
    else if(topIE){_IE_BANDS.forEach(b=>{it.sanVariants[b.key].inspEffect=readIE(topIE);});}
    if(it.sanVariants['>90'].image) it.sanVariants['=0'].image=it.sanVariants['>90'].image;

    return it;
  }
}
// DEV-TOOLS:END
