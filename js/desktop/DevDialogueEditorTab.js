// DEV-TOOLS:START
/**
 * DevDialogueEditorTab — dialogue-editor.html/js ported into DeveloperMode.
 * Inline onclick= handlers reference window._de (set on mount, cleared on unmount).
 * Document-level listeners are registered with an AbortController so they are
 * removed cleanly when the user switches to a different dev tab.
 */

const _DE_LS = 'cultists_dialogue_editor_v1';
const _DE_SPEAKERS = [
  { id:'player',   label:'主控',  color:'#4a90d9' },
  { id:'aje',      label:'阿杰',  color:'#e07b39' },
  { id:'awei',     label:'阿伟',  color:'#5a9e5a' },
  { id:'binbin',   label:'彬彬',  color:'#b05cb0' },
  { id:'narrator', label:'旁白',  color:'#888888' },
];
const _DE_PHASES = [
  { id:'a', label:'白天' },
  { id:'b', label:'傍晚/夜晚' },
];
const _DE_BUILTIN_VARS = [
  { id:'day',          label:'天数',              type:'number', min:0, max:30 },
  { id:'phase',        label:'时段',              type:'select', opts:['a','b'] },
  { id:'sanity',       label:'理智值 (sanity)',   type:'number', min:0, max:100 },
  { id:'clarity',      label:'清晰值 (clarity)',  type:'number', min:0, max:100, note:'理智值降至 0 时自动解锁，初始值 10' },
  { id:'aje_favor',    label:'阿杰好感度',        type:'number', min:0, max:100 },
  { id:'awei_favor',   label:'阿伟好感度',        type:'number', min:0, max:100 },
  { id:'binbin_favor', label:'彬彬好感度',        type:'number', min:0, max:100 },
  { id:'aje_label',    label:'玩家对阿杰的标签',  type:'select', opts:['','邪教徒','邪教教主','被邪教蛊惑者','无辜者','邪神化身'] },
  { id:'awei_label',   label:'玩家对阿伟的标签',  type:'select', opts:['','邪教徒','邪教教主','被邪教蛊惑者','无辜者','邪神化身'] },
  { id:'binbin_label', label:'玩家对彬彬的标签',  type:'select', opts:['','邪教徒','邪教教主','被邪教蛊惑者','无辜者','邪神化身'] },
  { id:'suspicion',    label:'室友怀疑度',        type:'number', min:0, max:100 },
  { id:'ate_potion',   label:'是否吃秘药',        type:'bool' },
  { id:'cast_spell',   label:'施放法术',          type:'bool' },
];
const _DE_NUMVARS = ['sanity','clarity','aje_favor','awei_favor','binbin_favor','suspicion'];
const _DE_COND_OPS = ['==','!=','>','>=','<','<=','has','nothas'];

export class DevDialogueEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    this.project = null;
    this.currentCtx = null;       // { type:'schedule'|'event'|'ending', id, entryIndex }
    this.currentQueue = 'work';
    this.loadedScheduleFiles = new Set();
    this.selectedNodeId = null;
    this._dragState = null;
    this._connectMode = false;
    this._connectFrom = null;     // { nodeId, optIdx }
    this.totalDays = 5;
    this.gameItems = [];
    this.gameSpells = [];
    this._abort = null;           // AbortController for document listeners
  }

  // ── utilities ─────────────────────────────────────────────────────────────
  _el(id) { return document.getElementById(id); }
  _e(s)   { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  _uid(p) { return `${p||'id'}_${(Date.now()+Math.random()).toString(36).slice(-6)}`; }
  _st(msg) { this._dev.setStatus(msg); }
  _spk(id) { return _DE_SPEAKERS.find(s=>s.id===id)||_DE_SPEAKERS[0]; }
  _allVars() { return [..._DE_BUILTIN_VARS,...(this.project?.customVars||[])]; }
  _ctxData() {
    if (!this.currentCtx||!this.project) return null;
    const {type,id}=this.currentCtx;
    if (type==='schedule') {
      const schedule = this.project.schedules?.[id];
      const entry = schedule?.entries?.[this.currentCtx.entryIndex];
      return entry?.dialogueTree || null;
    }
    if (type==='event')  return this.project.events[id];
    if (type==='ending') return this.project.endings[id];
    return null;
  }
  _emptyNode(x=100,y=100) {
    return {id:this._uid('n'),speaker:'player',text:'',keywordIds:[],next:null,options:[],onShow:{},entryConds:[],x,y};
  }
  _emptyOpt() { return {id:this._uid('opt'),label:'',next:null,effects:{},conditions:[]}; }
  _emptyCtx() { return {nodes:{},startNodeId:null}; }
  _emptyProject() {
    const schedules={};
    for (let d=1;d<=5;d++) for (const queue of ['work','social']) for (const ph of ['a','b']) schedules[`${queue}${String(d).padStart(2,'0')}${ph}`]={entries:[]};
    return {version:2,totalDays:5,customVars:[],schedules,events:{},endings:{}};
  }

  _normalizeGameTree(tree) {
    if (!tree?.nodes) return this._emptyCtx();
    const nodes = {};
    Object.entries(tree.nodes).forEach(([id, node]) => {
      nodes[id] = { id, speaker: node.speaker || 'npc', text: node.text || '',
        keywordIds: [], next: node.next || null, options: (node.options || []).map(opt => ({
          id: this._uid('opt'), label: opt.label || '', next: opt.next || null,
          effects: opt.effects || {}, conditions: opt.condition ? [opt.condition] : (opt.conditions || []),
        })), onShow: node.onShow || {}, entryConds: node.condition ? [node.condition] : (node.entryConds || []),
        x: node.x || 100, y: node.y || 100 };
    });
    return { nodes, startNodeId: tree.start || tree.startNodeId || Object.keys(nodes)[0] || null };
  }

  _migrateProject(project) {
    if (!project || typeof project !== 'object') return this._emptyProject();
    if (project.schedules) return project;
    const schedules = {};
    Object.entries(project.days || {}).forEach(([oldId, ctx]) => {
      const match = /^day(\d\d)([ab])$/.exec(oldId);
      if (!match) return;
      schedules[`social${match[1]}${match[2]}`] = { entries: [{ id: `${oldId}_entry`, type: 'other', name: oldId, avatar: '🙂', dialogueTree: ctx }] };
    });
    return { ...project, version: 2, schedules, days: undefined };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  mount() {
    window._de = this;
    // load persisted project
    if (!this._loadLS()) this.project = this._emptyProject();
    this.project = this._migrateProject(this.project);
    this.loadedScheduleFiles = new Set(this.project.loadedScheduleFiles || []);
    this.totalDays = this.project.totalDays||5;
    // try pick up items/spells from item editor localStorage
    try {
      const seed = localStorage.getItem('cultists_item_editor_v2');
      if (seed) {
        const d = JSON.parse(seed);
        this.gameItems  = (d.items||[]).map(it=>({id:it.id,name:it.name||it.id}));
        this.gameSpells = (d.items||[]).flatMap(it=>(it.spells||[]).map(s=>({name:s.name})));
      }
    } catch(e) {}
    // document-level listeners with cleanup
    this._abort = new AbortController();
    const sig = this._abort.signal;
    document.addEventListener('keydown', e=>{
      if (e.key==='Escape') this._cancelConnect();
      if ((e.ctrlKey||e.metaKey)&&e.key==='s') { e.preventDefault(); this._saveProject(); }
      if ((e.ctrlKey||e.metaKey)&&e.key==='n') { e.preventDefault(); this.addNode(); }
    }, {signal:sig});
    this._renderSidebar();
    this._ensureArrowMarker();
  }
  unmount() {
    window._de = null;
    if (this._abort) { this._abort.abort(); this._abort = null; }
  }

  // ── HTML skeleton ─────────────────────────────────────────────────────────
  html() {
    return `<div class="dev-de-root">
<div class="dev-de-header">
  <button type="button" class="win95-btn dev-btn" onclick="_de._newProject()">📄 新建</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._saveProject()">💾 保存</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._loadProjectFile()">📂 载入</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._importFromGame()">⬇ 从游戏读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._showExportModal()">📤 导出</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._showVarsModal()">⚙ 变量</button>
  <input type="file" id="de-file-input" accept=".json" style="display:none" onchange="_de._onProjectFile(event)">
  <input type="file" id="de-game-input" accept=".json" multiple style="display:none" onchange="_de._onGameFiles(event)">
</div>
<div class="dev-de-main">
  <!-- Sidebar -->
  <div class="dev-de-sidebar">
    <div id="de-queue-tabs" class="dev-de-phase-tabs">
      <div class="dev-de-ptab" data-queue="work" onclick="_de._selectQueue('work')">Work 患者</div>
      <div class="dev-de-ptab" data-queue="social" onclick="_de._selectQueue('social')">Social 联系人</div>
    </div>
    <div id="de-phase-tabs" class="dev-de-phase-tabs">
      <div class="dev-de-ptab" data-phase="a" onclick="_de._selectPhase('a')">08:00 白班</div>
      <div class="dev-de-ptab" data-phase="b" onclick="_de._selectPhase('b')">16:00 夜班</div>
    </div>
    <div id="de-sidebar-inner" style="flex:1;overflow-y:auto;padding:4px">
      <div class="dev-de-sb-sec">
        <div class="dev-de-sb-title">📅 天数
          <button class="dev-de-sb-add" type="button" onclick="_de.addDay()" title="新增一天">＋</button>
        </div>
        <div id="de-sb-days"></div>
      </div>
      <div class="dev-de-sb-sec">
        <div class="dev-de-sb-title">🎪 事件
          <button class="dev-de-sb-add" type="button" onclick="_de._addEvent()" title="新增事件">＋</button>
        </div>
        <div id="de-sb-events"></div>
      </div>
      <div class="dev-de-sb-sec">
        <div class="dev-de-sb-title">🏁 结局
          <button class="dev-de-sb-add" type="button" onclick="_de._addEnding()" title="新增结局">＋</button>
        </div>
        <div id="de-sb-endings"></div>
      </div>
    </div>
  </div>
  <!-- Canvas -->
  <div class="dev-de-canvas-wrap">
    <div class="dev-de-canvas-toolbar">
      <span id="de-canvas-ctx" style="font-size:12px;font-weight:bold;color:#000080;min-width:150px">请从左侧选择天数或事件</span>
      <button type="button" class="win95-btn dev-btn" onclick="_de.addNode()">＋ 节点</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._autoLayout()">🔧 自动排布</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._setStartNode()">🏠 设为起点</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._deleteSelectedNode()">🗑 删节点</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._addScheduleEntry()">＋ 日程条目</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._deleteScheduleEntry()">🗑 删日程条目</button>
    </div>
    <div id="de-canvas-container" class="dev-de-canvas-container" onclick="_de._onCanvasClick(event)">
      <svg id="de-canvas-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible" width="2000" height="1200"></svg>
      <div id="de-canvas-nodes" style="position:absolute;top:0;left:0;min-width:2000px;min-height:1200px"></div>
    </div>
  </div>
  <!-- Editor panel -->
  <div class="dev-de-editor">
    <div class="dev-de-editor-title">节点编辑器</div>
    <div id="de-editor-body" style="flex:1;overflow-y:auto;padding:6px">
      <div id="de-editor-empty" style="padding:20px;text-align:center;color:#555;font-size:12px">👈 点击画布中的节点来编辑</div>
      <div id="de-editor-form" style="display:none">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">发言角色</div>
          <div style="display:flex;gap:3px;flex-wrap:wrap" id="de-spk-btns">
            ${_DE_SPEAKERS.map(s=>`<button type="button" class="win95-btn dev-btn dev-de-spk-btn" data-spk="${s.id}" onclick="_de._setSpeaker('${s.id}')">${s.label}</button>`).join('')}
          </div>
        </div>
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">对话文本</div>
          <textarea class="dev-textarea" id="de-ed-text" style="width:100%;height:80px;resize:vertical" placeholder="输入对话内容…" oninput="_de._saveNodeText()"></textarea>
        </div>
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">亮起关键词 ID（逗号分隔）</div>
          <input style="width:100%;min-height:23px;border:2px inset #eee;padding:2px 4px" id="de-ed-keywords" placeholder="keyword_id1, keyword_id2" oninput="_de._saveNodeKeywords()">
        </div>
        <hr style="border:none;border-top:1px solid #808080;margin:6px 0">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">选项分支</div>
          <div id="de-opt-list"></div>
          <button type="button" class="win95-btn dev-btn" style="width:100%;margin-top:3px" onclick="_de._addOption()">＋ 添加选项</button>
        </div>
        <hr style="border:none;border-top:1px solid #808080;margin:6px 0">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">直接跳转（无选项时）</div>
          <div style="display:flex;gap:4px">
            <select id="de-ed-next" style="flex:1;min-height:23px;border:2px inset #eee;padding:2px" onchange="_de._saveNodeNext()">
              <option value="">(结束)</option>
            </select>
            <button type="button" class="win95-btn dev-btn" onclick="_de._addNodeAndLink()">＋新节点</button>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #808080;margin:6px 0">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">onShow 效果</div>
          <div id="de-onshow-effects">
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:11px">
              <span>好感：阿杰</span><input class="dev-de-wnum" id="de-os-aje" type="number" placeholder="0" oninput="_de._saveOnShow()">
              <span>阿伟</span><input class="dev-de-wnum" id="de-os-awei" type="number" placeholder="0" oninput="_de._saveOnShow()">
              <span>彬彬</span><input class="dev-de-wnum" id="de-os-binbin" type="number" placeholder="0" oninput="_de._saveOnShow()">
            </div>
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:11px">
              <span>理智值</span><input class="dev-de-wnum" id="de-os-sanity" type="number" placeholder="0" oninput="_de._saveOnShow()">
              <span>怀疑度</span><input class="dev-de-wnum" id="de-os-suspicion" type="number" placeholder="0" oninput="_de._saveOnShow()">
              <span title="sanity=0解锁">清晰值</span><input class="dev-de-wnum" id="de-os-clarity" type="number" placeholder="0" oninput="_de._saveOnShow()">
            </div>
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:11px">
              <span>给予物品</span><input style="flex:1;min-height:21px;border:1px inset #eee;padding:1px 3px;font-size:11px" id="de-os-grant" placeholder="item_id" oninput="_de._saveOnShow()">
            </div>
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:11px">
              <span>移除物品</span><input style="flex:1;min-height:21px;border:1px inset #eee;padding:1px 3px;font-size:11px" id="de-os-remove" placeholder="item_id" oninput="_de._saveOnShow()">
            </div>
            <div style="display:flex;align-items:center;gap:4px;font-size:11px">
              <span>触发结局</span><input style="flex:1;min-height:21px;border:1px inset #eee;padding:1px 3px;font-size:11px" id="de-os-ending" placeholder="ending_id" oninput="_de._saveOnShow()">
            </div>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #808080;margin:6px 0">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">进入条件</div>
          <div id="de-entry-conds"></div>
          <button type="button" class="win95-btn dev-btn" style="width:100%;margin-top:3px" onclick="_de._addEntryCond()">＋ 添加条件</button>
        </div>
      </div>
    </div>
  </div>
</div>
<!-- modal -->
<div id="de-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center" onclick="_de._closeModalIfBg(event)">
  <div style="background:#c0c0c0;border:3px outset #fff;min-width:300px;max-width:500px" onclick="event.stopPropagation()">
    <div id="de-modal-title" style="background:#000080;color:#fff;padding:3px 8px;font-size:13px;font-weight:bold"></div>
    <div id="de-modal-body" style="padding:12px"></div>
    <div style="padding:6px 8px;display:flex;justify-content:flex-end;gap:6px;border-top:1px solid #808080">
      <button type="button" class="win95-btn dev-btn" onclick="_de._closeModal()">关闭</button>
    </div>
  </div>
</div>
</div>`;
  }


  // ── sidebar ───────────────────────────────────────────────────────────────
  _renderSidebar() {
    const dayEl = this._el('de-sb-days');
    const evEl  = this._el('de-sb-events');
    const endEl = this._el('de-sb-endings');
    if (!dayEl) return;
    this._el('de-queue-tabs')?.querySelectorAll('[data-queue]').forEach((tab) => tab.classList.toggle('active', tab.dataset.queue === this.currentQueue));
    let dayHtml = '';
    for (let d = 1; d <= this.totalDays; d++) {
      const pad = String(d).padStart(2,'0');
      const phase = this.currentCtx?.type === 'schedule' && this.currentCtx.id.endsWith('b') ? 'b' : 'a';
      const file = `${this.currentQueue}${pad}${phase}`;
      const schedule = this.project.schedules?.[file] || { entries: [] };
      const isActive = this.currentCtx?.type === 'schedule' && this.currentCtx.id === file;
      const entries = schedule.entries.map((entry, index) => `<div class="dev-de-sb-item${isActive && this.currentCtx.entryIndex === index ? ' active' : ''}" onclick="_de._selectSchedule('${file}',${index})">${this._e(entry.name || entry.npcId || entry.id || `条目 ${index + 1}`)}</div>`).join('');
      dayHtml += `<div class="dev-de-sb-day${isActive?' active':''}" onclick="_de._selectSchedule('${file}',0)">第 ${d} 天 · ${phase === 'a' ? '08:00' : '16:00'}${schedule.entries.length ? `（${schedule.entries.length} 条）` : ''}</div>${entries}`;
    }
    dayEl.innerHTML = dayHtml;
    evEl.innerHTML  = Object.keys(this.project.events||{}).map(id=>
      `<div class="dev-de-sb-item${this.currentCtx?.id===id?' active':''}" onclick="_de._selectCtx('event','${id}')">
        ${this._e(id)}<button type="button" class="dev-de-sb-del" onclick="event.stopPropagation();_de._deleteCtx('event','${id}')">✕</button></div>`
    ).join('')||'<div class="dev-de-sb-empty">暂无</div>';
    endEl.innerHTML = Object.keys(this.project.endings||{}).map(id=>
      `<div class="dev-de-sb-item${this.currentCtx?.id===id?' active':''}" onclick="_de._selectCtx('ending','${id}')">
        ${this._e(id)}<button type="button" class="dev-de-sb-del" onclick="event.stopPropagation();_de._deleteCtx('ending','${id}')">✕</button></div>`
    ).join('')||'<div class="dev-de-sb-empty">暂无</div>';
  }

  _selectQueue(queue) {
    this.currentQueue = queue;
    const phase = this.currentCtx?.type === 'schedule' && this.currentCtx.id.endsWith('b') ? 'b' : 'a';
    const day = this.currentCtx?.type === 'schedule' ? this.currentCtx.id.slice(5, 7) : '01';
    this._selectSchedule(`${queue}${day}${phase}`, 0);
  }

  _selectDayGroup(d) {
    const pad = String(d).padStart(2,'0');
    const curPh = (this.currentCtx?.type==='schedule'&&this.currentCtx.id.endsWith('b')) ? 'b' : 'a';
    this._selectSchedule(`${this.currentQueue}${pad}${curPh}`, 0);
  }

  _selectPhase(ph) {
    if (!this.currentCtx||this.currentCtx.type!=='schedule') return;
    this._selectSchedule(this.currentCtx.id.slice(0,-1)+ph, 0);
  }

  _selectSchedule(id, entryIndex = 0) {
    this.currentQueue = id.startsWith('social') ? 'social' : 'work';
    const schedule = this.project.schedules?.[id] || { entries: [] };
    if (!schedule.entries.length) {
      this._st(`${id}.json 暂无条目，请先导入或新增条目`);
      this.currentCtx = { type: 'schedule', id, entryIndex: 0 };
      this.selectedNodeId = null;
      this._renderSidebar(); this._renderCanvas();
      return;
    }
    this._selectCtx('schedule', id, Math.min(entryIndex, schedule.entries.length - 1));
  }

  _selectCtx(type, id, entryIndex = 0) {
    this.currentCtx = {type, id, entryIndex};
    this.selectedNodeId = null;
    const ptabs = this._el('de-phase-tabs');
    if (ptabs) {
      ptabs.style.display = type==='schedule' ? 'flex' : 'none';
      if (type==='schedule') {
        const ph = id.endsWith('b') ? 'b' : 'a';
        ptabs.querySelectorAll('.dev-de-ptab').forEach(t=>t.classList.toggle('active', t.dataset.phase===ph));
      }
    }
    const lbl = this._el('de-canvas-ctx');
    if (lbl) {
      if (type==='schedule') {
        const d=parseInt(id.slice(5,7)), ph=id.endsWith('b')?'16:00 夜班':'08:00 白班';
        lbl.textContent=`${id.startsWith('social')?'Social 联系人':'Work 患者'} · 第 ${d} 天 · ${ph} · 条目 ${this.currentCtx.entryIndex + 1}`;
      } else { lbl.textContent=`${type==='event'?'事件':'结局'} · ${id}`; }
    }
    this._renderSidebar();
    this._renderCanvas();
    const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
 }

 _addScheduleEntry() {
 if (!this.currentCtx || this.currentCtx.type !== 'schedule') {
   this._st('请先选择 Work 或 Social 日程文件');
   return;
 }
 const schedule = this.project.schedules[this.currentCtx.id] || (this.project.schedules[this.currentCtx.id] = { entries: [] });
 const isWork = this.currentCtx.id.startsWith('work');
 const entry = { id: `${isWork ? 'patient' : 'contact'}_${Date.now().toString(36).slice(-5)}`,
   ...(isWork ? { name: '新患者', age: 0 } : { type: 'other', name: '新联系人', avatar: '🙂' }),
   dialogueTree: this._emptyCtx() };
 schedule.entries.push(entry);
 this.loadedScheduleFiles.add(this.currentCtx.id);
 this._saveLS();
 this._selectSchedule(this.currentCtx.id, schedule.entries.length - 1);
 }

 _deleteScheduleEntry() {
 if (!this.currentCtx || this.currentCtx.type !== 'schedule') return;
 const schedule = this.project.schedules[this.currentCtx.id];
 if (!schedule?.entries?.length || !confirm('确认删除当前日程条目？')) return;
 schedule.entries.splice(this.currentCtx.entryIndex, 1);
 this.loadedScheduleFiles.add(this.currentCtx.id);
 this._saveLS();
 if (!schedule.entries.length) this._selectSchedule(this.currentCtx.id, 0);
 else this._selectSchedule(this.currentCtx.id, Math.min(this.currentCtx.entryIndex, schedule.entries.length - 1));
 }

  _deleteCtx(type, id) {
    if (!confirm(`确认删除 ${type} "${id}"？`)) return;
    if (type==='event')  delete this.project.events[id];
    if (type==='ending') delete this.project.endings[id];
    if (this.currentCtx?.id===id) { this.currentCtx=null; this._renderCanvas(); }
    this._renderSidebar(); this._saveLS();
  }

  // ── canvas ────────────────────────────────────────────────────────────────
  _ensureArrowMarker() {
    const svg=this._el('de-canvas-svg'); if(!svg) return;
    if (svg.querySelector('#de-arrow')) return;
    const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML=`<marker id="de-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#000080"/></marker>`;
    svg.appendChild(defs);
  }

  _renderCanvas() {
    this._ensureArrowMarker();
    const data=this._ctxData();
    const container=this._el('de-canvas-nodes');
    if (!container) return;
    if (!data) { container.innerHTML=''; const s=this._el('de-canvas-svg'); if(s) Array.from(s.children).filter(c=>c.tagName!=='defs').forEach(c=>c.remove()); return; }
    this._renderNodes(data, container);
    this._drawArrows(data);
  }

  _renderNodes(data, container) {
    container.innerHTML='';
    container.style.cursor = this._connectMode ? 'crosshair' : '';
    Object.values(data.nodes||{}).forEach(node=>{
      const spk=this._spk(node.speaker);
      const isStart=node.id===data.startNodeId, isSel=node.id===this.selectedNodeId;
      const div=document.createElement('div');
      div.className=`dev-de-node${isSel?' selected':''}${isStart?' start':''}`;
      div.id=`de-node-${node.id}`;
      div.style.cssText=`left:${node.x||60}px;top:${node.y||60}px`;
      const optBadge=node.options?.length?`<span class="dev-de-nbadge">${node.options.length}选项</span>`:'';
      const nxtBadge=node.next&&!(node.options?.length)?`<span class="dev-de-nbadge">→${this._e(String(node.next).slice(-8))}</span>`:'';
      div.innerHTML=`
        <div class="dev-de-node-hd" style="background:${spk.color}">
          <span>${this._e(spk.label)}${isStart?' 🏠':''}</span>
          <button type="button" class="dev-de-node-link" onclick="event.stopPropagation();_de._startConnect('${node.id}',null)" title="连线">🔗</button>
        </div>
        <div class="dev-de-node-body">${this._e((node.text||'').slice(0,60))}</div>
        <div class="dev-de-node-ft">${optBadge}${nxtBadge}</div>`;
      div.addEventListener('mousedown', e=>{
        if (e.button!==0) return;
        if (this._connectMode) { this._finishConnect(node.id); return; }
        e.stopPropagation();
        this._selectNode(node.id);
        const sx=e.clientX, sy=e.clientY, ox=node.x||60, oy=node.y||60;
        let moved=false;
        const onMove=mv=>{ moved=true; node.x=Math.max(0,ox+(mv.clientX-sx)); node.y=Math.max(0,oy+(mv.clientY-sy)); div.style.left=node.x+'px'; div.style.top=node.y+'px'; this._drawArrows(data); };
        const onUp=()=>{ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); if(moved) this._saveLS(); };
        document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
      });
      container.appendChild(div);
    });
  }

  _drawArrows(data) {
    const svg=this._el('de-canvas-svg'); if(!svg) return;
    Array.from(svg.children).filter(c=>c.tagName!=='defs').forEach(c=>c.remove());
    const wrap=this._el('de-canvas-container');
    const wr=wrap?wrap.getBoundingClientRect():{left:0,top:0};
    const sx=wrap?wrap.scrollLeft:0, sy=wrap?wrap.scrollTop:0;
    const arc=(fId,tId,color,dashed)=>{
      const fEl=document.getElementById(`de-node-${fId}`), tEl=document.getElementById(`de-node-${tId}`);
      if(!fEl||!tEl) return;
      const fr=fEl.getBoundingClientRect(), tr=tEl.getBoundingClientRect();
      const x1=fr.left-wr.left+fr.width/2+sx, y1=fr.top-wr.top+fr.height+sy;
      const x2=tr.left-wr.left+tr.width/2+sx, y2=tr.top-wr.top+sy;
      const dy=Math.max(40,Math.abs(y2-y1)/2);
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`);
      p.setAttribute('stroke',color||'#000080'); p.setAttribute('stroke-width','2');
      p.setAttribute('fill','none'); p.setAttribute('marker-end','url(#de-arrow)');
      if(dashed) p.setAttribute('stroke-dasharray','5,3');
      svg.appendChild(p);
    };
    Object.values(data.nodes||{}).forEach(node=>{
      if(node.next) arc(node.id,node.next,'#000080',false);
      (node.options||[]).forEach((opt,i)=>{ if(opt.next) arc(node.id,opt.next,`hsl(${(i*55+200)%360},60%,40%)`,true); });
    });
  }

  _selectNode(id) {
    this.selectedNodeId=id;
    this._renderCanvas();
    this._loadNodeEditor();
  }

  _onCanvasClick(e) {
    const t=e.target;
    if (t.id==='de-canvas-container'||t.id==='de-canvas-nodes'||t.closest('svg')) {
      if (this._connectMode) { this._cancelConnect(); return; }
      this.selectedNodeId=null;
      const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
      if(ef) ef.style.display=''; if(ff) ff.style.display='none';
      this._renderCanvas();
    }
  }

  // ── node editor ──────────────────────────────────────────────────────────
  _loadNodeEditor() {
    const data = this._ctxData(); if (!data||!this.selectedNodeId) return;
    const node = data.nodes[this.selectedNodeId]; if (!node) return;
    const ef=this._el('de-editor-empty'), ff=this._el('de-editor-form');
    if (ef) ef.style.display='none'; if (ff) ff.style.display='';
    // speaker buttons
    this._el('de-spk-btns')?.querySelectorAll('.dev-de-spk-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.spk===node.speaker);
      b.style.borderColor = b.dataset.spk===node.speaker ? this._spk(node.speaker).color : '';
    });
    const txt=this._el('de-ed-text'); if(txt) txt.value=node.text||'';
    const kw=this._el('de-ed-keywords'); if(kw) kw.value=(node.keywordIds||[]).join(', ');
    // next dropdown
    this._rebuildNextDropdown('de-ed-next', node.next, data);
    // options
    this._renderOptList(node, data);
    // onShow
    const os=node.onShow||{};
    const set=(id,v)=>{ const e=this._el(id); if(e) e.value=v||''; };
    set('de-os-aje',     os.aje_favor);
    set('de-os-awei',    os.awei_favor);
    set('de-os-binbin',  os.binbin_favor);
    set('de-os-sanity',  os.sanity);
    set('de-os-suspicion',os.suspicion);
    set('de-os-clarity', os.clarity);
    set('de-os-grant',   (os.grantItems||[]).join(', '));
    set('de-os-remove',  (os.removeItems||[]).join(', '));
    set('de-os-ending',  os.ending);
    // entry conditions
    this._renderEntryConds(node);
  }

  _rebuildNextDropdown(dropId, currentVal, data) {
    const sel=this._el(dropId); if(!sel) return;
    const nodeIds=Object.keys(data.nodes||{});
    sel.innerHTML=`<option value="">(结束)</option>`+nodeIds.map(id=>
      `<option value="${this._e(id)}"${id===currentVal?' selected':''}>${this._e(id)}</option>`
    ).join('');
  }

  _setSpeaker(spkId) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    node.speaker=spkId; this._saveLS(); this._loadNodeEditor(); this._renderCanvas();
  }

  _saveNodeText() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    node.text=this._el('de-ed-text')?.value||''; this._saveLS();
    // update canvas card text without full re-render
    const body=document.querySelector(`#de-node-${this.selectedNodeId} .dev-de-node-body`);
    if(body) body.textContent=(node.text||'').slice(0,60);
  }

  _saveNodeKeywords() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    const raw=this._el('de-ed-keywords')?.value||'';
    node.keywordIds=raw.split(',').map(s=>s.trim()).filter(Boolean); this._saveLS();
  }

  _saveNodeNext() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    node.next=this._el('de-ed-next')?.value||null; this._saveLS(); this._drawArrows(data);
  }

  _saveOnShow() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    const num=id=>{ const v=parseFloat(this._el(id)?.value); return isNaN(v)?null:v; };
    const str=id=>this._el(id)?.value.trim()||null;
    const os={};
    const naje=num('de-os-aje');   if(naje)  os.aje_favor=naje;
    const nawei=num('de-os-awei'); if(nawei) os.awei_favor=nawei;
    const nbin=num('de-os-binbin');if(nbin)  os.binbin_favor=nbin;
    const nsan=num('de-os-sanity');if(nsan)  os.sanity=nsan;
    const nsus=num('de-os-suspicion');if(nsus) os.suspicion=nsus;
    const ncl=num('de-os-clarity');if(ncl)   os.clarity=ncl;
    const grant=str('de-os-grant'); if(grant) os.grantItems=grant.split(',').map(s=>s.trim()).filter(Boolean);
    const rem=str('de-os-remove');  if(rem)   os.removeItems=rem.split(',').map(s=>s.trim()).filter(Boolean);
    const end=str('de-os-ending');  if(end)   os.ending=end;
    node.onShow=os; this._saveLS();
  }

  // ── options ───────────────────────────────────────────────────────────────
  _renderOptList(node, data) {
    const el=this._el('de-opt-list'); if(!el) return;
    if (!node.options?.length) { el.innerHTML='<div style="color:#aaa;font-size:12px;padding:4px 0">无分支选项</div>'; return; }
    el.innerHTML=node.options.map((opt,i)=>{
      const nextOpts=Object.keys(data.nodes||{}).map(id=>`<option value="${this._e(id)}"${id===opt.next?' selected':''}>${this._e(id)}</option>`).join('');
      const eff=opt.effects||{};
      return `<div class="dev-de-opt-row">
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:11px;color:#666;min-width:12px">${i+1}.</span>
          <input class="dev-de-opt-label" placeholder="选项文本…" value="${this._e(opt.label||'')}" oninput="_de._saveOptLabel(${i},this.value)">
          <select class="dev-de-opt-next" onchange="_de._saveOptNext(${i},this.value)"><option value="">(结束)</option>${nextOpts}</select>
          <button type="button" class="win95-btn dev-btn" onclick="_de._startConnect(null,${i})" title="连线">🔗</button>
          <button type="button" class="win95-btn dev-btn" onclick="_de._deleteOption(${i})">✕</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding:3px 0 0 16px;font-size:11px">
          <label>好感阿杰<input class="dev-de-wnum" type="number" value="${eff.aje_favor||''}" placeholder="0" oninput="_de._saveOptEff(${i},'aje_favor',this.value)"></label>
          <label>阿伟<input class="dev-de-wnum" type="number" value="${eff.awei_favor||''}" placeholder="0" oninput="_de._saveOptEff(${i},'awei_favor',this.value)"></label>
          <label>彬彬<input class="dev-de-wnum" type="number" value="${eff.binbin_favor||''}" placeholder="0" oninput="_de._saveOptEff(${i},'binbin_favor',this.value)"></label>
          <label>理智<input class="dev-de-wnum" type="number" value="${eff.sanity||''}" placeholder="0" oninput="_de._saveOptEff(${i},'sanity',this.value)"></label>
          <label>怀疑<input class="dev-de-wnum" type="number" value="${eff.suspicion||''}" placeholder="0" oninput="_de._saveOptEff(${i},'suspicion',this.value)"></label>
          <label>清晰<input class="dev-de-wnum" type="number" value="${eff.clarity||''}" placeholder="0" oninput="_de._saveOptEff(${i},'clarity',this.value)"></label>
        </div>
      </div>`;
    }).join('');
  }

  _saveOptLabel(i, val) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node||!node.options[i]) return;
    node.options[i].label=val; this._saveLS();
  }
  _saveOptNext(i, val) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node||!node.options[i]) return;
    node.options[i].next=val||null; this._saveLS(); this._drawArrows(data);
  }
  _saveOptEff(i, field, val) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node||!node.options[i]) return;
    if (!node.options[i].effects) node.options[i].effects={};
    const n=parseFloat(val); node.options[i].effects[field]=isNaN(n)?val:n; this._saveLS();
  }
  _addOption() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    if (!node.options) node.options=[];
    node.options.push(this._emptyOpt()); this._saveLS(); this._renderOptList(node, data);
  }
  _deleteOption(i) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    node.options.splice(i,1); this._saveLS(); this._renderOptList(node,data); this._drawArrows(data);
  }

  // ── entry conditions ──────────────────────────────────────────────────────
  _renderEntryConds(node) {
    const el=this._el('de-entry-conds'); if(!el) return;
    const vars=this._allVars();
    el.innerHTML=(node.entryConds||[]).map((c,i)=>{
      const varOpts=vars.map(v=>`<option value="${this._e(v.id)}"${v.id===c.var?' selected':''}>${this._e(v.label)}</option>`).join('');
      const opOpts=_DE_COND_OPS.map(op=>`<option${op===c.op?' selected':''}>${op}</option>`).join('');
      return `<div style="display:flex;gap:3px;margin-bottom:3px;font-size:11px">
        <select style="flex:2;min-height:21px;border:1px inset #eee" onchange="_de._saveCond(${i},'var',this.value)">${varOpts}</select>
        <select style="flex:0 0 56px;min-height:21px;border:1px inset #eee" onchange="_de._saveCond(${i},'op',this.value)">${opOpts}</select>
        <input style="flex:1;min-height:21px;border:1px inset #eee;padding:1px 3px" value="${this._e(c.value||'')}" oninput="_de._saveCond(${i},'value',this.value)">
        <button type="button" class="win95-btn dev-btn" onclick="_de._deleteCond(${i})">✕</button>
      </div>`;
    }).join('')||'<div style="color:#aaa;font-size:12px">无条件（始终显示）</div>';
  }
  _addEntryCond() {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    if (!node.entryConds) node.entryConds=[];
    node.entryConds.push({var:'sanity',op:'>=',value:'0'}); this._saveLS(); this._renderEntryConds(node);
  }
  _saveCond(i,field,val) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node||!node.entryConds[i]) return;
    node.entryConds[i][field]=val; this._saveLS();
  }
  _deleteCond(i) {
    const data=this._ctxData(); if(!data||!this.selectedNodeId) return;
    const node=data.nodes[this.selectedNodeId]; if(!node) return;
    node.entryConds.splice(i,1); this._saveLS(); this._renderEntryConds(node);
  }

  // ── connect mode ─────────────────────────────────────────────────────────
  _startConnect(nodeId, optIdx) {
    this._connectMode = true;
    this._connectFrom = { nodeId: nodeId || this.selectedNodeId, optIdx };
    this._st('连线模式：点击目标节点；按 Esc 取消');
    const container = this._el('de-canvas-nodes');
    if (container) container.style.cursor = 'crosshair';
  }

  _finishConnect(targetId) {
    const data = this._ctxData();
    if (!data || !this._connectFrom) { this._cancelConnect(); return; }
    const { nodeId, optIdx } = this._connectFrom;
    const node = data.nodes[nodeId];
    if (node) {
      if (optIdx !== null && node.options?.[optIdx]) node.options[optIdx].next = targetId;
      else node.next = targetId;
    }
    this._cancelConnect();
    this._saveLS();
    this._renderCanvas();
    if (this.selectedNodeId) this._loadNodeEditor();
  }

  _cancelConnect() {
    this._connectMode = false; this._connectFrom = null;
    const container = this._el('de-canvas-nodes');
    if (container) container.style.cursor = '';
    this._st('');
  }

  // ── node CRUD ─────────────────────────────────────────────────────────────
  addNode() {
    const data = this._ctxData(); if (!data) { this._st('请先从左侧选择天数或事件'); return; }
    const node = this._emptyNode(80 + Object.keys(data.nodes).length * 20, 80 + Object.keys(data.nodes).length * 20);
    data.nodes[node.id] = node;
    if (!data.startNodeId) data.startNodeId = node.id;
    this._saveLS(); this._renderCanvas(); this._selectNode(node.id);
  }

  _addNodeAndLink() {
    const data = this._ctxData(); if (!data || !this.selectedNodeId) return;
    const cur = data.nodes[this.selectedNodeId]; if (!cur) return;
    const node = this._emptyNode((cur.x||60)+220, cur.y||60);
    data.nodes[node.id] = node;
    if (!cur.options?.length) cur.next = node.id;
    this._saveLS(); this._renderCanvas(); this._selectNode(node.id);
  }

  _deleteSelectedNode() {
    const data = this._ctxData(); if (!data || !this.selectedNodeId) return;
    if (!confirm('确认删除此节点？')) return;
    delete data.nodes[this.selectedNodeId];
    Object.values(data.nodes).forEach(n => {
      if (n.next === this.selectedNodeId) n.next = null;
      (n.options||[]).forEach(o => { if (o.next === this.selectedNodeId) o.next = null; });
    });
    if (data.startNodeId === this.selectedNodeId) data.startNodeId = Object.keys(data.nodes)[0] || null;
    this.selectedNodeId = null;
    const ef = this._el('de-editor-empty'), ff = this._el('de-editor-form');
    if (ef) ef.style.display = ''; if (ff) ff.style.display = 'none';
    this._saveLS(); this._renderCanvas();
  }

  _setStartNode() {
    const data = this._ctxData(); if (!data || !this.selectedNodeId) return;
    data.startNodeId = this.selectedNodeId;
    this._saveLS(); this._renderCanvas();
    this._st(`已将 ${this.selectedNodeId} 设为起点`);
  }

  // ── auto layout ───────────────────────────────────────────────────────────
  _autoLayout() {
    const data = this._ctxData(); if (!data) return;
    const nodes = data.nodes; const ids = Object.keys(nodes);
    if (!ids.length) return;
    const W = 200, H = 120, GAPX = 60, GAPY = 40;
    // BFS from startNode
    const start = data.startNodeId || ids[0];
    const visited = new Set(), queue = [[start, 0, 0]], cols = {};
    while (queue.length) {
      const [id, col, row] = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      if (!cols[col]) cols[col] = 0;
      nodes[id].x = col * (W + GAPX) + 40;
      nodes[id].y = cols[col] * (H + GAPY) + 40;
      cols[col]++;
      const n = nodes[id]; const nextCol = col + 1;
      if (n.next && nodes[n.next] && !visited.has(n.next)) queue.push([n.next, nextCol, 0]);
      (n.options||[]).forEach(o => { if (o.next && nodes[o.next] && !visited.has(o.next)) queue.push([o.next, nextCol, 0]); });
    }
    // place any unreachable nodes
    let orphanRow = Object.values(cols).reduce((a,b)=>Math.max(a,b),0);
    ids.filter(id => !visited.has(id)).forEach(id => { nodes[id].x = 40; nodes[id].y = orphanRow * (H + GAPY) + 40; orphanRow++; });
    this._saveLS(); this._renderCanvas();
  }

  // ── day / event / ending ──────────────────────────────────────────────────
  addDay() {
    if (!this.project) return;
    this.totalDays += 1;
    this.project.totalDays = this.totalDays;
    const pad = String(this.totalDays).padStart(2,'0');
    for (const ph of ['a','b']) {
      const k = `day${pad}${ph}`;
      if (!this.project.days[k]) this.project.days[k] = this._emptyCtx();
    }
    this._renderSidebar(); this._saveLS();
    this._st(`已添加第 ${this.totalDays} 天`);
  }

  _addEvent() {
    const id = prompt('事件 ID（英文/数字，唯一）:', 'event_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.events[id]) { alert('ID 已存在'); return; }
    this.project.events[id] = this._emptyCtx();
    this._renderSidebar(); this._saveLS(); this._selectCtx('event', id);
  }

  _addEnding() {
    const id = prompt('结局 ID（英文/数字，唯一）:', 'ending_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.endings[id]) { alert('ID 已存在'); return; }
    this.project.endings[id] = this._emptyCtx();
    this._renderSidebar(); this._saveLS(); this._selectCtx('ending', id);
  }

  // ── persistence ───────────────────────────────────────────────────────────
  _saveLS() {
    try { localStorage.setItem(_DE_LS, JSON.stringify({ ...this.project, loadedScheduleFiles: [...this.loadedScheduleFiles] })); } catch(e) {}
  }
  _loadLS() {
    try {
      const raw = localStorage.getItem(_DE_LS); if (!raw) return false;
      const d = JSON.parse(raw); if (!d?.version) return false;
      this.project = d; return true;
    } catch(e) { return false; }
  }

  // ── project file ops ──────────────────────────────────────────────────────
  _newProject() {
    if (!confirm('新建项目会清除未保存的内容，继续？')) return;
    this.project = this._emptyProject();
    this.loadedScheduleFiles = new Set();
    this.totalDays = 5; this.currentCtx = null; this.selectedNodeId = null;
    this._saveLS(); this._renderSidebar(); this._renderCanvas();
    const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
    this._st('已新建项目');
  }

  _saveProject() {
    this._saveLS(); this._st('已保存到浏览器');
  }

  _loadProjectFile() { this._el('de-file-input')?.click(); }

  _onProjectFile(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.version) { alert('无法识别的项目格式'); return; }
        this.project = this._migrateProject(d); this.loadedScheduleFiles = new Set(Object.keys(this.project.schedules || {})); this.totalDays = d.totalDays || 5;
        this.currentCtx = null; this.selectedNodeId = null;
        this._saveLS(); this._renderSidebar(); this._renderCanvas();
        this._st('项目已载入：' + f.name);
      } catch(err) { alert('JSON 解析失败：' + err.message); }
    };
    r.readAsText(f, 'utf-8'); ev.target.value = '';
  }

  _importFromGame() { this._el('de-game-input')?.click(); }

  _onGameFiles(ev) {
    const files = Array.from(ev.target.files); if (!files.length) return;
    let count = 0;
    const done = () => {
      count++;
      if (count === files.length) { this._saveLS(); this._renderSidebar(); this._st(`已导入 ${files.length} 个游戏文件`); }
    };
    files.forEach(f => {
      const r = new FileReader();
      r.onload = e => {
        try {
          const d = JSON.parse(e.target.result);
          // New schedule files are queue-specific and always use { entries: [] }.
          const name = f.name.replace(/\.json$/,'');
          if (/^(work|social)\d{2}[ab]$/.test(name) && Array.isArray(d.entries)) {
            this.project.schedules[name] = { ...d, entries: d.entries.map((entry) => ({
              ...entry, dialogueTree: this._normalizeGameTree(entry.dialogueTree),
            })) };
            this.loadedScheduleFiles.add(name);
          } else {
            // Accept legacy dayXXa/b files as Social files during migration.
          if (/^day\d{2}[ab]$/.test(name) && (d.contacts || d.patients)) {
            const target = `social${name.slice(3)}`;
            this.project.schedules[target] = { entries: (d.contacts || d.patients || []).map((entry) => ({
              ...entry, dialogueTree: this._normalizeGameTree(entry.dialogueTree),
            })) };
            this.loadedScheduleFiles.add(target);
          }
          }
        } catch(_) {}
        done();
      };
      r.readAsText(f, 'utf-8');
    });
    ev.target.value = '';
  }

  // ── export ────────────────────────────────────────────────────────────────
  _showExportModal() {
    this._openModal('导出', `
      <p style="font-size:12px;margin-bottom:8px">选择导出格式：</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button type="button" class="win95-btn dev-btn" onclick="_de._exportProject()">💾 导出完整编辑器项目（.json）</button>
        <button type="button" class="win95-btn dev-btn" onclick="_de._exportGameFiles()">🎮 导出游戏格式（每个日程文件一个 JSON）</button>
        <button type="button" class="win95-btn dev-btn" onclick="_de._writeGameFiles()">💽 写入所有日程文件</button>
      </div>`);
  }

  _exportProject() {
    const blob = new Blob([JSON.stringify(this.project, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'dialogue-project.json'; a.click(); URL.revokeObjectURL(a.href);
    this._closeModal(); this._st('编辑器项目已导出');
  }

  _exportGameFiles() {
    const schedules = this.project?.schedules || {};
    Object.entries(schedules).forEach(([key, schedule]) => {
      const out = this._scheduleToGame(schedule);
      if (!out) return;
      const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = key + '.json'; a.click(); URL.revokeObjectURL(a.href);
    });
    this._closeModal(); this._st('游戏格式已导出');
  }

  async _writeGameFiles() {
    const schedules = this.project?.schedules || {};
    const files = Object.entries(schedules).filter(([key, schedule]) => this.loadedScheduleFiles.has(key) && schedule?.entries);
    await Promise.all(files.map(([key, schedule]) => this._dev.writeToDisk(`${key}.json`, this._scheduleToGame(schedule))));
    this._st(`已写入 ${files.length} 个日程文件`);
  }

  _scheduleToGame(schedule) {
    return { entries: (schedule?.entries || []).map((entry) => {
      const out = { ...entry };
      out.dialogueTree = this._ctxToGameTree(entry.dialogueTree);
      return out;
    }) };
  }

  _ctxToGameTree(ctx) {
    const nodes = ctx?.nodes; if (!nodes || !Object.keys(nodes).length) return { start: ctx?.startNodeId || null, nodes: {} };
    const gameNodes = {};
    Object.values(nodes).forEach(n => {
      const gn = { speaker: n.speaker === 'player' ? 'player' : 'npc', text: n.text || '' };
      if (n.entryConds?.length) gn.condition = n.entryConds[0];
      if (n.options?.length) gn.options = n.options.map(o => {
        const option = { label: o.label || '', next: o.next || null };
        if (o.conditions?.length) option.condition = o.conditions[0];
        if (o.effects && Object.keys(o.effects).length) option.effects = o.effects;
        return option;
      });
      if (n.next) gn.next = n.next;
      if (n.onShow && Object.keys(n.onShow).length) {
        const os = {};
        if (n.onShow.grantItems?.length) os.grantItems = n.onShow.grantItems;
        if (n.onShow.removeItems?.length) os.removeItems = n.onShow.removeItems;
        if (n.onShow.ending) os.ending = n.onShow.ending;
        const favs = ['aje','awei','binbin'].filter(x => n.onShow[x+'_favor']);
        favs.forEach(x => { os.favorabilityChange = os.favorabilityChange||{}; os.favorabilityChange[x+'_favor'] = n.onShow[x+'_favor']; });
        if (Object.keys(os).length) gn.onShow = os;
      }
      gameNodes[n.id] = gn;
    });
    return { start: ctx.startNodeId || Object.keys(gameNodes)[0], nodes: gameNodes };
  }

  // ── variables modal ───────────────────────────────────────────────────────
  _showVarsModal() {
    const custom = this.project?.customVars || [];
    const builtinHtml = _DE_BUILTIN_VARS.map(v =>
      `<tr><td style="color:#555">${this._e(v.id)}</td><td>${this._e(v.label)}</td><td style="color:#888">${v.type}</td><td style="color:#888">${v.note||'—'}</td></tr>`
    ).join('');
    const customHtml = custom.map((v,i) =>
      `<tr><td><input style="min-height:20px;border:1px inset #eee;width:90px" value="${this._e(v.id)}" oninput="_de._editCustomVar(${i},'id',this.value)"></td>
        <td><input style="min-height:20px;border:1px inset #eee;width:90px" value="${this._e(v.label)}" oninput="_de._editCustomVar(${i},'label',this.value)"></td>
        <td><select style="min-height:20px;border:1px inset #eee" onchange="_de._editCustomVar(${i},'type',this.value)">
          ${['number','bool','string'].map(t=>`<option${t===v.type?' selected':''}>${t}</option>`).join('')}
        </select></td>
        <td><button type="button" class="win95-btn dev-btn" onclick="_de._removeCustomVar(${i})">✕</button></td></tr>`
    ).join('');
    this._openModal('变量列表', `
      <p style="font-size:12px;margin-bottom:6px"><strong>内置变量（只读）</strong></p>
      <table style="font-size:11px;width:100%;border-collapse:collapse;margin-bottom:10px">
        <thead><tr style="background:#000080;color:#fff"><th style="padding:2px 4px">ID</th><th>标签</th><th>类型</th><th>备注</th></tr></thead>
        <tbody>${builtinHtml}</tbody>
      </table>
      <p style="font-size:12px;margin-bottom:4px"><strong>自定义变量</strong></p>
      <table style="font-size:11px;width:100%;border-collapse:collapse;margin-bottom:6px" id="de-custom-var-table">
        <thead><tr style="background:#404040;color:#fff"><th style="padding:2px 4px">ID</th><th>标签</th><th>类型</th><th></th></tr></thead>
        <tbody>${customHtml||'<tr><td colspan="4" style="color:#aaa;padding:4px">暂无自定义变量</td></tr>'}</tbody>
      </table>
      <button type="button" class="win95-btn dev-btn" onclick="_de._addCustomVar()">＋ 新增变量</button>`);
  }

  _addCustomVar() {
    if (!this.project.customVars) this.project.customVars = [];
    this.project.customVars.push({ id:'var_'+Date.now().toString(36).slice(-4), label:'新变量', type:'number' });
    this._saveLS(); this._showVarsModal();
  }
  _editCustomVar(i, field, val) {
    if (!this.project.customVars?.[i]) return;
    this.project.customVars[i][field] = val; this._saveLS();
  }
  _removeCustomVar(i) {
    this.project.customVars?.splice(i,1); this._saveLS(); this._showVarsModal();
  }

  // ── modal helpers ─────────────────────────────────────────────────────────
  _openModal(title, bodyHtml) {
    const ov = this._el('de-modal-overlay'); if (!ov) return;
    const t = this._el('de-modal-title'), b = this._el('de-modal-body');
    if (t) t.textContent = title; if (b) b.innerHTML = bodyHtml;
    ov.style.display = 'flex';
  }
  _closeModal() {
    const ov = this._el('de-modal-overlay'); if (ov) ov.style.display = 'none';
  }
  _closeModalIfBg(e) { if (e.target === this._el('de-modal-overlay')) this._closeModal(); }
}
// DEV-TOOLS:END


