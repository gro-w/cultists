// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";
import { scheduleData } from "../core/ScheduleData.js";
import { MAX_GAME_DAYS } from "../core/GameRules.js";
import { SCHEDULE_NODE_TYPES, getScheduleNodeDefinition } from "../core/ScheduleNodeRegistry.js";
import { validateBlueprint } from "../core/ScheduleBlueprint.js";
import { bgmManager } from "../core/BgmManager.js";

/**
 * DevDialogueEditorTab — the schedule editor graph UI.
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
  { id:'day',          label:'天数',              type:'number', min:1, max:MAX_GAME_DAYS },
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
const _DE_NODE_LABELS = Object.fromEntries(SCHEDULE_NODE_TYPES.map(type => [type, getScheduleNodeDefinition(type).label]));

export class DevDialogueEditorTab {
  constructor(devMode) {
    this._dev = devMode;
    this.project = null;
    this.currentCtx = null;       // { type:'schedule'|'event'|'ending', id, entryIndex }
    this.currentQueue = 'work';
    this.loadedScheduleFiles = new Set();
    this.loadedMetaFiles = new Set();
    this.selectedNodeId = null;
    this._dragState = null;
    this._connectMode = false;
    this._connectFrom = null;     // { nodeId, optIdx }
    this.totalDays = MAX_GAME_DAYS;
    this.gameItems = [];
    this.gameSpells = [];
    this._inputModes = new Map();
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
    return {id:this._uid('n'),type:'text',speaker:'player',text:'',keywordIds:[],next:null,options:[],onShow:{},entryConds:[],inputs:{},outputs:{},x,y};
  }
  _emptyOpt() { return {id:this._uid('opt'),label:'',next:null,effects:{},conditions:[]}; }
  _emptyCtx() { return {nodes:{},connections:[],startNodeId:null}; }
  _emptyProject(totalDays = MAX_GAME_DAYS) {
    totalDays = Math.min(MAX_GAME_DAYS, Math.max(1, Number(totalDays) || MAX_GAME_DAYS));
    const schedules={};
    for (let d=1;d<=totalDays;d++) for (const queue of ['work','social']) for (const ph of ['a','b']) schedules[`${queue}${String(d).padStart(2,'0')}${ph}`]={entries:[]};
    return {version:2,totalDays,customVars:[],schedules,events:{},endings:{},eventFileDoc:{events:[]},endingFileDoc:{endings:[]}};
  }

  _normalizeGameTree(tree) {
    if (!tree?.nodes) return this._emptyCtx();
    const nodes = {};
    Object.entries(tree.nodes).forEach(([id, node]) => {
      nodes[id] = { id, type: node.type || 'text', speaker: node.speaker || node.inputs?.speaker || 'npc', text: node.text || node.inputs?.text || '', inputs: node.inputs || {}, outputs: node.outputs || {},
        keywordIds: [], next: node.next || null, options: (node.options || []).map(opt => ({
          id: this._uid('opt'), label: opt.label || '', next: opt.next || null,
          effects: opt.effects || {}, conditions: opt.condition ? [opt.condition] : (opt.conditions || []),
        })), onShow: node.onShow || {}, entryConds: node.condition ? [node.condition] : (node.entryConds || []),
        x: node.x ?? 100, y: node.y ?? 100 };
    });
    const connections = Array.isArray(tree.connections) ? tree.connections.map(connection => ({ ...connection })) : [];
    const startNodeId = tree.startNodeId || tree.start || Object.keys(nodes)[0] || null;
    if (!Object.values(nodes).some(node => node.type === 'flowStart')) {
      const flowStartId = '__start';
      nodes[flowStartId] = { id: flowStartId, type: 'flowStart', inputs: {}, outputs: {}, x: 40, y: 40 };
      if (startNodeId && nodes[startNodeId]) connections.unshift({ fromNodeId: flowStartId, fromPort: 'flowOut', toNodeId: startNodeId, toPort: 'flowIn' });
      return { nodes, connections, startNodeId: flowStartId };
    }
    return { nodes, connections, startNodeId };
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
    this.project = this._emptyProject();
    this.loadedScheduleFiles = new Set();
    this.loadedMetaFiles = new Set();
    this._loadCurrentGame();
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
  <button type="button" class="win95-btn dev-btn" onclick="_de._loadCurrentGame()">⬇ 从当前游戏读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._exportGameFiles()">📤 导出 JSON</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._writeGameFiles()">💽 写入磁盘</button>
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
      <label class="dev-de-node-type-label">节点类型
        <select id="de-new-node-type" class="dev-de-node-type">
          ${SCHEDULE_NODE_TYPES.map(type=>`<option value="${type}">${this._e(_DE_NODE_LABELS[type])} (${type})</option>`).join('')}
        </select>
      </label>
      <button type="button" class="win95-btn dev-btn" onclick="_de.addNode()">＋ 新增日程节点</button>
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
    <div class="dev-de-editor-title">日程节点编辑器</div>
    <div id="de-editor-body" style="flex:1;overflow-y:auto;padding:6px">
      <div id="de-editor-empty" style="padding:20px;text-align:center;color:#555;font-size:12px">👈 点击画布中的节点来编辑</div>
      <div id="de-editor-form" style="display:none">
        <div class="dev-de-ed-sec">
          <div class="dev-de-ed-label">节点种类</div>
          <select id="de-ed-type" style="width:100%;min-height:23px;border:2px inset #eee" onchange="_de._saveNodeType(this.value)">
            ${SCHEDULE_NODE_TYPES.map(type=>`<option value="${type}">${this._e(_DE_NODE_LABELS[type])} (${type})</option>`).join('')}
          </select>
          <div class="dev-de-ed-label" style="margin-top:4px">节点输入</div>
          <div id="de-ed-inputs"></div>
          <div id="de-ed-outputs" class="dev-de-port-summary"></div>
        </div>
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
            <div class="dev-de-onshow-bgm">
              <span>🎵 BGM 动作</span>
              <select id="de-os-bgm-action" onchange="_de._saveOnShow()">
                <option value="">(不改变)</option>
                <option value="play">play — 播放指定 BGM</option>
                <option value="stop">stop — 停止（静音）</option>
                <option value="restore">restore — 恢复上层 BGM</option>
              </select>
              <select id="de-os-bgm-id" onchange="_de._saveOnShow()">
                <option value="">(选择曲目)</option>
              </select>
              <span class="dev-de-onshow-bgm-indicator" id="de-os-bgm-warn" style="display:none">⚠️ BGM ID 无效</span>
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
    const publicFile = `${this.currentQueue}pub`;
    const publicSchedule = this.project.schedules?.[publicFile] || { entries: [] };
    const publicActive = this.currentCtx?.type === 'schedule' && this.currentCtx.id === publicFile;
    dayHtml += `<div class="dev-de-sb-day${publicActive ? ' active' : ''}" onclick="_de._selectSchedule('${publicFile}',0)">${this.currentQueue === 'work' ? 'Work' : 'Social'} 公共日程${publicSchedule.entries.length ? `（${publicSchedule.entries.length} 条）` : ''}</div>`;
    if (publicActive) dayHtml += publicSchedule.entries.map((entry, index) => `<div class="dev-de-sb-item active" onclick="_de._selectSchedule('${publicFile}',${index})">${this._e(entry.name || entry.npcId || entry.id || `条目 ${index + 1}`)}</div>`).join('');
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
    if (type==='event')  { delete this.project.events[id]; this.loadedMetaFiles.add('special_events.json'); }
    if (type==='ending') { delete this.project.endings[id]; this.loadedMetaFiles.add('endings.json'); }
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

  _portsFor(node, direction) {
    const def = getScheduleNodeDefinition(node.type || 'text') || {};
    const ports = direction === 'input' ? [...(def.flowInputs || []), ...(def.valueInputs || [])] : [...(def.flowOutputs || []), ...(def.valueOutputs || [])];
    if (node.type === 'choice' && direction === 'output') {
      (node.options || []).forEach((_, index) => ports.push({ name: `option${index}`, kind: 'flow', type: null }));
    }
    if (node.type === 'choice' && direction === 'input') {
      (node.options || []).forEach((_, index) => ports.push({ name: `label${index}`, kind: 'value', type: 'string' }));
    }
    return ports;
  }

  _portMarkup(node, direction) {
    return this._portsFor(node, direction).map((port, index) =>
      `<div class="dev-de-port-row ${direction === 'input' ? 'input' : 'output'}" style="top:${38 + index * 19}px">
        ${direction === 'input' ? `<span class="dev-de-port-pin" data-node-id="${this._e(node.id)}" data-port="${this._e(port.name)}" data-kind="${port.kind}" data-direction="input" title="${port.kind === 'flow' ? '流程输入' : '数值输入'}"></span>` : ''}
        <span class="dev-de-port-label">${this._e(port.name)}</span>
        ${direction === 'output' ? `<span class="dev-de-port-pin" data-node-id="${this._e(node.id)}" data-port="${this._e(port.name)}" data-kind="${port.kind}" data-direction="output" title="${port.kind === 'flow' ? '流程输出' : '数值输出'}"></span>` : ''}
      </div>`).join('');
  }

  _renderNodes(data, container) {
    container.innerHTML='';
    container.style.cursor = this._connectMode ? 'crosshair' : '';
    Object.values(data.nodes||{}).forEach(node=>{
      const spk=this._spk(node.speaker);
      const nodeLabel=_DE_NODE_LABELS[node.type||'text']||'显示文字';
      const isStart=node.id===data.startNodeId, isSel=node.id===this.selectedNodeId;
      const div=document.createElement('div');
      div.className=`dev-de-node${isSel?' selected':''}${isStart?' start':''}`;
      div.id=`de-node-${node.id}`;
      div.style.cssText=`left:${node.x||60}px;top:${node.y||60}px`;
      const optBadge=node.options?.length?`<span class="dev-de-nbadge">${node.options.length}选项</span>`:'';
      const nxtBadge=node.next&&!(node.options?.length)?`<span class="dev-de-nbadge">→${this._e(String(node.next).slice(-8))}</span>`:'';
      const bgmBadge=node.onShow?.bgm?.action==='play'&&node.onShow.bgm.bgmId
        ? `<span class="dev-de-nbadge" title="BGM: ${this._e(node.onShow.bgm.bgmId)}" style="background:#006600;color:#fff">🎵</span>`
        : node.onShow?.bgm?.action==='stop'
        ? `<span class="dev-de-nbadge" title="BGM: stop" style="background:#660000;color:#fff">🎵✕</span>`
        : node.onShow?.bgm?.action==='restore'
        ? `<span class="dev-de-nbadge" title="BGM: restore" style="background:#004080;color:#fff">🎵↩</span>`
        : '';
      div.innerHTML=`
        <div class="dev-de-node-hd" style="background:${spk.color}">
          <span>${this._e(nodeLabel)} · ${this._e(spk.label)}${isStart?' 🏠':''}</span>
          <button type="button" class="dev-de-node-link" onclick="event.stopPropagation();_de._startConnect('${node.id}',null)" title="连线">🔗</button>
        </div>
        <div class="dev-de-node-body">${this._e((node.type&&node.type!=='text') ? JSON.stringify(node.inputs||{}) : (node.text||'').slice(0,60))}</div>
        <div class="dev-de-port-layer inputs">${this._portMarkup(node, 'input')}</div>
        <div class="dev-de-port-layer outputs">${this._portMarkup(node, 'output')}</div>
        <div class="dev-de-node-ft">${optBadge}${nxtBadge}${bgmBadge}</div>`;
      div.querySelectorAll('.dev-de-port-pin').forEach(pin => pin.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        this._startPortConnect(node.id, pin.dataset.port, pin.dataset.kind, pin.dataset.direction, pin);
        this._drawArrows(data);
        const onMove = mv => {
          this._drawArrows(data);
          this._drawTempConnection(pin, mv.clientX, mv.clientY);
        };
        const onUp = up => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          const target = document.elementFromPoint(up.clientX, up.clientY)?.closest('.dev-de-port-pin');
          if (target && target.dataset.direction === 'input') this._finishPortConnect(target.dataset.nodeId, target.dataset.port, target.dataset.kind);
          else this._cancelConnect();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp, { once: true });
      }));
      div.addEventListener('pointerdown', e=>{
        if (e.button!==0) return;
        if (e.target.closest('.dev-de-port-pin') || e.target.closest('button')) return;
        if (this._connectMode) { this._finishConnect(node.id); return; }
        e.stopPropagation();
        this.selectedNodeId=node.id;
        this._loadNodeEditor();
        div.classList.add('selected');
        const sx=e.clientX, sy=e.clientY, ox=node.x||60, oy=node.y||60;
        let moved=false;
        const onMove=mv=>{ moved=true; node.x=Math.max(0,ox+(mv.clientX-sx)); node.y=Math.max(0,oy+(mv.clientY-sy)); div.style.left=node.x+'px'; div.style.top=node.y+'px'; this._drawArrows(data); };
        const onUp=()=>{ document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); this._dragState=null; if(moved) this._saveLS(); };
        this._dragState={nodeId:node.id};
        document.addEventListener('pointermove',onMove);
        document.addEventListener('pointerup',onUp, { once: true });
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
    const arc=(fId,tId,color,dashed,sourceEl=null,targetPort=null)=>{
      const fEl=document.getElementById(`de-node-${fId}`), tEl=document.getElementById(`de-node-${tId}`);
      if(!fEl||!tEl) return;
      const fr=fEl.getBoundingClientRect(), tr=tEl.getBoundingClientRect();
      const sourceRect=sourceEl?.getBoundingClientRect();
      const targetEl=targetPort ? tEl.querySelector(`[data-port="${CSS.escape(targetPort)}"]`) : null;
      const targetRect=targetEl?.getBoundingClientRect();
      const x1=sourceRect ? sourceRect.left-wr.left+sourceRect.width/2+sx : fr.left-wr.left+fr.width+sx;
      const y1=sourceRect ? sourceRect.top-wr.top+sourceRect.height/2+sy : fr.top-wr.top+fr.height/2+sy;
      const x2=targetRect ? targetRect.left-wr.left+targetRect.width/2+sx : tr.left-wr.left+sx;
      const y2=targetRect ? targetRect.top-wr.top+targetRect.height/2+sy : tr.top-wr.top+tr.height/2+sy;
      const dx=Math.max(40,Math.abs(x2-x1)/2);
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`);
      p.setAttribute('stroke',color||'#000080'); p.setAttribute('stroke-width','2');
      p.setAttribute('fill','none'); p.setAttribute('marker-end','url(#de-arrow)');
      if(dashed) p.setAttribute('stroke-dasharray','5,3');
      svg.appendChild(p);
    };
    Object.values(data.nodes||{}).forEach(node=>{
      if(node.next) arc(node.id,node.next,'#000080',false,null,'flowIn');
      (node.options||[]).forEach((opt,i)=>{
        if (!opt.next) return;
        const pin = document.getElementById(`de-node-${node.id}`)?.querySelector(`[data-port="option${i}"]`);
        arc(node.id,opt.next,`hsl(${(i*55+200)%360},60%,40%)`,true,pin,'flowIn');
      });
    });
    (data.connections||[]).forEach(connection=>{
      if(connection.fromNodeId && connection.toNodeId) {
        const source = document.getElementById(`de-node-${connection.fromNodeId}`)?.querySelector(`[data-port="${CSS.escape(connection.fromPort || '')}"]`);
        const color = connection.fromPort?.startsWith('option') ? '#804000' : connection.fromPort === 'value' ? '#008040' : '#000080';
        arc(connection.fromNodeId, connection.toNodeId, color, false, source, connection.toPort);
      }
    });
  }

  _drawTempConnection(source, clientX, clientY) {
    const svg=this._el('de-canvas-svg'), wrap=this._el('de-canvas-container');
    if(!svg||!wrap||!source) return;
    const wr=wrap.getBoundingClientRect(), sx=wrap.scrollLeft, sy=wrap.scrollTop;
    const sr=source.getBoundingClientRect();
    const x1=sr.left-wr.left+sr.width/2+sx, y1=sr.top-wr.top+sr.height/2+sy;
    const x2=clientX-wr.left+sx, y2=clientY-wr.top+sy;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    const dx=Math.max(40, Math.abs(x2-x1)/2);
    p.setAttribute('d',`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`);
    p.setAttribute('stroke','#cc6600'); p.setAttribute('stroke-width','2');
    p.setAttribute('stroke-dasharray','5,3'); p.setAttribute('fill','none');
    svg.appendChild(p);
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
    const typeEl=this._el('de-ed-type'); if(typeEl) typeEl.value=node.type||'text';
    this._renderNodeInputs(node, data);
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
    // BGM selects: populate track options, then restore saved values
    const bgmActionSel = this._el('de-os-bgm-action');
    const bgmIdSel     = this._el('de-os-bgm-id');
    const bgmWarn      = this._el('de-os-bgm-warn');
    if (bgmIdSel) {
      bgmIdSel.innerHTML = '<option value="">(选择曲目)</option>' +
        bgmManager.allTracks().map(t =>
          `<option value="${this._e(t.id)}">${this._e(t.name || t.id)}</option>`
        ).join('');
    }
    const bgm = os.bgm || {};
    if (bgmActionSel) bgmActionSel.value = bgm.action || '';
    if (bgmIdSel)     bgmIdSel.value     = bgm.bgmId  || '';
    // show id selector only when action === 'play'
    if (bgmIdSel)  bgmIdSel.style.display  = (bgm.action === 'play') ? '' : 'none';
    // warn when bgmId is set but the track no longer exists
    const idInvalid = bgm.action === 'play' && bgm.bgmId && !bgmManager.tracks.has(bgm.bgmId);
    if (bgmWarn) bgmWarn.style.display = idInvalid ? '' : 'none';
    // Show/hide bgmId select live when action changes
    if (bgmActionSel) bgmActionSel.onchange = () => {
      if (bgmIdSel) bgmIdSel.style.display = (bgmActionSel.value === 'play') ? '' : 'none';
      _de._saveOnShow();
    };
    // entry conditions
    this._renderEntryConds(node);
  }

  _saveNodeType(type) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    if(!node || !getScheduleNodeDefinition(type)) return;
    node.type=type;
    if(type==='flowStart') { node.speaker=undefined; node.text=undefined; node.options=[]; }
    data.connections=(data.connections||[]).filter(connection => {
      const from=getScheduleNodePort(data.nodes[connection.fromNodeId]?.type,connection.fromPort,'output');
      const to=getScheduleNodePort(data.nodes[connection.toNodeId]?.type,connection.toPort,'input');
      return from && to && from.kind===to.kind && (from.kind==='flow' || from.type==='any' || to.type==='any' || from.type===to.type);
    });
    this._saveLS(); this._renderCanvas(); this._loadNodeEditor();
  }

  _valueOutputRefs(data) {
    return Object.values(data.nodes || {}).flatMap(node => this._portsFor(node, 'output').filter(port => port.kind === 'value').map(port => ({ nodeId: node.id, port: port.name, label: `${node.id}.${port.name}` })));
  }

  _renderNodeInputs(node, data) {
    const el=this._el('de-ed-inputs'); if(!el) return;
    const def=getScheduleNodeDefinition(node.type || 'text') || {};
    const refs=this._valueOutputRefs(data);
    const connections=data.connections || [];
    const html=[...(def.flowInputs || []).map(port => `<div class="dev-de-input-row"><span>${this._e(port.name)}</span><em>流程输入引脚</em></div>`), ...(def.valueInputs || []).map(port => {
      const connection=connections.find(item=>item.toNodeId===node.id && item.toPort===port.name);
      const modeKey=`${node.id}:${port.name}`;
      const pinMode=this._inputModes.get(modeKey) ?? Boolean(connection);
      const raw=node.inputs?.[port.name];
      const value=raw && typeof raw==='object' && raw.nodeId ? '' : (raw ?? '');
      const refOptions=refs.filter(ref=>ref.nodeId!==node.id).map(ref=>`<option value="${this._e(`${ref.nodeId}::${ref.port}`)}" ${connection && connection.fromNodeId===ref.nodeId && connection.fromPort===ref.port ? 'selected' : ''}>${this._e(ref.label)}</option>`).join('');
      return `<div class="dev-de-input-row"><label>${this._e(port.name)}</label><select class="dev-de-input-mode" onchange="_de._setInputMode('${this._e(port.name)}',this.value)"><option value="constant" ${pinMode?'':'selected'}>常量</option><option value="pin" ${pinMode?'selected':''}>数值引脚</option></select>${pinMode ? `<select class="dev-de-input-source" onchange="_de._setInputSource('${this._e(port.name)}',this.value)"><option value="">选择输出引脚</option>${refOptions}</select>` : `<input class="dev-de-input-value" data-input-name="${this._e(port.name)}" type="${port.type==='number'?'number':'text'}" value="${this._e(value)}" oninput="_de._saveInputValue('${this._e(port.name)}',this.value)">`}</div>`;
    })].join('');
    el.innerHTML=html || '<div class="dev-de-no-ports">此节点没有输入</div>';
    const outputEl=this._el('de-ed-outputs');
    if(outputEl) {
      const outputs=this._portsFor(node,'output');
      outputEl.innerHTML=outputs.length ? `输出引脚：${outputs.map(port=>`<span class="dev-de-port-chip ${port.kind}">${this._e(port.name)}</span>`).join('')}` : '无输出引脚';
    }
  }

  _saveInputValue(name,value) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    const port=node && getScheduleNodePort(node.type,name,'input');
    if(!node || !port || port.kind!=='value') return;
    node.inputs={...(node.inputs||{}),[name]:port.type==='number' && value!=='' ? Number(value) : value};
    this._saveLS(); this._renderCanvas();
  }

  _setInputMode(name,mode) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    if(!node) return;
    this._inputModes.set(`${node.id}:${name}`, mode==='pin');
    data.connections=(data.connections||[]).filter(item=>!(item.toNodeId===node.id && item.toPort===name));
    if(mode==='pin' && node.inputs) delete node.inputs[name];
    this._saveLS(); this._renderNodeInputs(node,data); this._renderCanvas();
  }

  _setInputSource(name, value) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    if(!node || !value) return;
    const [fromNodeId, fromPort] = value.split('::');
    const source=getScheduleNodePort(data.nodes[fromNodeId]?.type, fromPort, 'output');
    const target=getScheduleNodePort(node.type, name, 'input');
    if(!source || !target || source.kind!=='value' || target.kind!=='value') { this._st('只能连接数值输出到数值输入'); return; }
    data.connections=(data.connections||[]).filter(item=>!(item.toNodeId===node.id && item.toPort===name));
    data.connections.push({fromNodeId,fromPort,toNodeId:node.id,toPort:name});
    this._saveLS(); this._renderNodeInputs(node,data); this._renderCanvas();
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
    // BGM
    const bgmAction=str('de-os-bgm-action');
    const bgmId=str('de-os-bgm-id');
    if(bgmAction) { os.bgm={ action:bgmAction }; if(bgmAction==='play' && bgmId) os.bgm.bgmId=bgmId; }
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
  _startPortConnect(nodeId, port, kind, direction, pin) {
    if (direction !== 'output') { this._st('请从输出引脚开始连线'); return; }
    this._connectMode=true;
    this._connectFrom={nodeId, port, kind, pin};
    this._st(`${kind === 'flow' ? '流程' : '数值'}连线：拖动到匹配的输入引脚`);
    const container=this._el('de-canvas-nodes'); if(container) container.style.cursor='crosshair';
  }

  _finishPortConnect(targetNodeId, targetPort, targetKind) {
    const data=this._ctxData(); const from=this._connectFrom;
    if(!data || !from) { this._cancelConnect(); return; }
    const source=getScheduleNodePort(data.nodes[from.nodeId]?.type, from.port, 'output');
    const target=getScheduleNodePort(data.nodes[targetNodeId]?.type, targetPort, 'input');
    if(from.nodeId===targetNodeId || !source || !target || source.kind!==target.kind || (source.kind==='value' && target.type!=='any' && source.type!=='any' && source.type!==target.type) || targetKind!==target.kind) {
      this._st('引脚类型不匹配：流程只能连接流程，数值只能连接数值'); this._cancelConnect(); return;
    }
    data.connections=(data.connections||[]).filter(item=>!(item.toNodeId===targetNodeId && item.toPort===targetPort) && !(item.fromNodeId===from.nodeId && item.fromPort===from.port));
    data.connections.push({fromNodeId:from.nodeId,fromPort:from.port,toNodeId:targetNodeId,toPort:targetPort});
    this._cancelConnect(); this._saveLS(); this._renderCanvas();
    if(this.selectedNodeId) this._loadNodeEditor();
  }

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
      const fromPort = optIdx !== null ? `option${optIdx}` : 'flowOut';
      const typed = node.type && node.type !== 'text';
      if (typed) {
        const source=getScheduleNodePort(node.type,fromPort,'output');
        const target=getScheduleNodePort(data.nodes[targetId]?.type,'flowIn','input');
        if(!source || !target || source.kind!=='flow' || target.kind!=='flow') { this._st('流程输出只能连接流程输入'); this._cancelConnect(); return; }
        data.connections = (data.connections || []).filter(connection => !(connection.fromNodeId === nodeId && connection.fromPort === fromPort));
        data.connections.push({ fromNodeId: nodeId, fromPort, toNodeId: targetId, toPort: 'flowIn' });
      } else if (optIdx !== null && node.options?.[optIdx]) node.options[optIdx].next = targetId;
      else node.next = targetId;
    }
    this._cancelConnect();
    this._saveLS();
    this._renderCanvas();
    if (this.selectedNodeId) this._loadNodeEditor();
  }

  _cancelConnect() {
    this._connectMode = false; this._connectFrom = null;
    this._connectDrag = null;
    const container = this._el('de-canvas-nodes');
    if (container) container.style.cursor = '';
    this._st('');
  }

  // ── node CRUD ─────────────────────────────────────────────────────────────
  addNode() {
    const data = this._ctxData(); if (!data) { this._st('请先从左侧选择天数或事件'); return; }
    const type = this._el('de-new-node-type')?.value || 'text';
    if (!type || !getScheduleNodeDefinition(type)) { this._st('已取消或节点种类无效'); return; }
    const node = this._emptyNode(80 + Object.keys(data.nodes).length * 20, 80 + Object.keys(data.nodes).length * 20);
    node.type=type;
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
    data.connections = (data.connections || []).filter(connection => connection.fromNodeId !== this.selectedNodeId && connection.toNodeId !== this.selectedNodeId);
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
    const W = 200, H = 120, GAPX = 40, GAPY = 50, PAD = 40, COLS = 4;
    // BFS from startNode to get traversal order, then append orphans
    const start = data.startNodeId || ids[0];
    const visited = new Set(), order = [];
    const queue = [start]; visited.add(start);
    while (queue.length) {
      const id = queue.shift(); order.push(id);
      const n = nodes[id];
      const nexts = [];
      if (n.next && nodes[n.next]) nexts.push(n.next);
      (n.options||[]).forEach(o => { if (o.next && nodes[o.next]) nexts.push(o.next); });
      nexts.forEach(nid => { if (!visited.has(nid)) { visited.add(nid); queue.push(nid); } });
    }
    ids.filter(id => !visited.has(id)).forEach(id => order.push(id));
    // Place in a grid: COLS columns, rows grow downward — all nodes stay in visible area
    order.forEach((id, i) => {
      nodes[id].x = PAD + (i % COLS) * (W + GAPX);
      nodes[id].y = PAD + Math.floor(i / COLS) * (H + GAPY);
    });
    this._saveLS(); this._renderCanvas();
  }

  // ── day / event / ending ──────────────────────────────────────────────────
  addDay() {
    if (!this.project) return;
    if (this.totalDays >= MAX_GAME_DAYS) { this._st(`游戏最多支持 ${MAX_GAME_DAYS} 天`); return; }
    this.totalDays += 1;
    this.project.totalDays = this.totalDays;
    const pad = String(this.totalDays).padStart(2,'0');
    for (const queue of ['work','social']) for (const ph of ['a','b']) {
      const k = `${queue}${pad}${ph}`;
      if (!this.project.schedules[k]) this.project.schedules[k] = {entries:[]};
    }
    this._renderSidebar(); this._saveLS();
    this._st(`已添加第 ${this.totalDays} 天`);
  }

  _addEvent() {
    const id = prompt('事件 ID（英文/数字，唯一）:', 'event_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.events[id]) { alert('ID 已存在'); return; }
    this.project.events[id] = this._emptyCtx();
    this.loadedMetaFiles.add('special_events.json');
    this._renderSidebar(); this._saveLS(); this._selectCtx('event', id);
  }

  _addEnding() {
    const id = prompt('结局 ID（英文/数字，唯一）:', 'ending_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.endings[id]) { alert('ID 已存在'); return; }
    this.project.endings[id] = this._emptyCtx();
    this.loadedMetaFiles.add('endings.json');
    this._renderSidebar(); this._saveLS(); this._selectCtx('ending', id);
  }

  // ── persistence ───────────────────────────────────────────────────────────
  _saveLS() {
    try { localStorage.setItem(_DE_LS, JSON.stringify({ ...this.project, loadedScheduleFiles: [...this.loadedScheduleFiles], loadedMetaFiles: [...this.loadedMetaFiles] })); } catch(e) {}
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
    this.loadedMetaFiles = new Set();
    this.totalDays = MAX_GAME_DAYS; this.currentCtx = null; this.selectedNodeId = null;
    this._saveLS(); this._renderSidebar(); this._renderCanvas();
    const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
    this._st('已新建项目');
  }

  _saveProject() {
    const errors=this._validateTypedBlueprints();
    if(errors.length){ alert(`蓝图校验失败：\n${errors.slice(0,8).join('\n')}`); return; }
    this._saveLS(); this._st('已保存到浏览器');
  }

  _validateTypedBlueprints() {
    const errors=[];
    const visit=(ctx,label)=>{
      if(!ctx?.nodes || !Object.values(ctx.nodes).some(node=>node.type && node.type!=='text')) return;
      const result=validateBlueprint(ctx);
      if(!result.ok) result.errors.forEach(error=>errors.push(`${label}: ${error}`));
    };
    Object.entries(this.project?.schedules||{}).forEach(([file,schedule])=>
      (schedule.entries||[]).forEach((entry,index)=>visit(entry.dialogueTree,`${file} 条目 ${index+1}`)));
    Object.entries(this.project?.events||{}).forEach(([id,ctx])=>visit(ctx,`事件 ${id}`));
    Object.entries(this.project?.endings||{}).forEach(([id,ctx])=>visit(ctx,`结局 ${id}`));
    return errors;
  }

  _loadProjectFile() { this._el('de-file-input')?.click(); }

  _onProjectFile(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.version) { alert('无法识别的项目格式'); return; }
        this.project = this._migrateProject(d);
        this.project.schedules = Object.fromEntries(Object.entries(this.project.schedules || {}).filter(([id]) => !/^(?:work|social)\d{2}[ab]$/.test(id) || Number(id.slice(5, 7)) <= MAX_GAME_DAYS));
        this.project.totalDays = MAX_GAME_DAYS;
        this.loadedScheduleFiles = new Set(Object.keys(this.project.schedules || {})); this.loadedMetaFiles = new Set(['special_events.json', 'endings.json']); this.totalDays = MAX_GAME_DAYS;
        this.currentCtx = null; this.selectedNodeId = null;
        this._saveLS(); this._renderSidebar(); this._renderCanvas();
        this._st('项目已载入：' + f.name);
      } catch(err) { alert('JSON 解析失败：' + err.message); }
    };
    r.readAsText(f, 'utf-8'); ev.target.value = '';
  }

  async _loadCurrentGame() {
    try {
      await scheduleData.init();
      this.totalDays = scheduleData.totalDays;
      this.project = this._emptyProject(this.totalDays);
      this.project.schedules.socialpub = { entries: [] };
      this.project.schedules.workpub = { entries: [] };
      this.loadedScheduleFiles = new Set();
      this.loadedMetaFiles = new Set(['special_events.json', 'endings.json']);
      const files = Object.keys(this.project.schedules);
      await Promise.all(files.map(async (name) => {
        const data = await dataLoader.loadJSON(`${name}.json`);
        if (!Array.isArray(data.entries)) throw new Error(`${name}.json 缺少 entries 数组`);
        if (data.entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
          throw new Error(`${name}.json 的 entries 必须全部是 JSON 对象`);
        }
        this.project.schedules[name] = { ...data, entries: data.entries.map((entry) => ({
          ...entry, dialogueTree: this._normalizeGameTree(entry.blueprint || entry.dialogueTree),
        })) };
        this.loadedScheduleFiles.add(name);
      }));
      const [eventFileDoc, endingFileDoc] = await Promise.all([
        dataLoader.loadJSON('special_events.json'),
        dataLoader.loadJSON('endings.json'),
      ]);
      this.project.eventFileDoc = eventFileDoc;
      this.project.endingFileDoc = endingFileDoc;
      this.project.events = Object.fromEntries((eventFileDoc.events || []).map((entry) => [
        entry.id, this._normalizeGameTree(entry.blueprint || entry.dialogueTree),
      ]));
      this.project.endings = Object.fromEntries((endingFileDoc.endings || []).map((entry) => [
        entry.id, this._normalizeGameTree(entry.blueprint || entry.dialogueTree),
      ]));
      this.currentCtx = null; this.selectedNodeId = null;
      this._saveLS(); this._renderSidebar(); this._renderCanvas();
      this._st(`已从当前游戏读取 ${files.length} 个日程文件`);
    } catch (err) { this._st(`读取当前游戏失败：${err.message}`, true); }
  }

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
              ...entry, dialogueTree: this._normalizeGameTree(entry.blueprint || entry.dialogueTree),
            })) };
            this.loadedScheduleFiles.add(name);
          } else {
            // Accept legacy dayXXa/b files as Social files during migration.
          if (/^day\d{2}[ab]$/.test(name) && (d.contacts || d.patients)) {
            const target = `social${name.slice(3)}`;
            this.project.schedules[target] = { entries: (d.contacts || d.patients || []).map((entry) => ({
              ...entry, dialogueTree: this._normalizeGameTree(entry.blueprint || entry.dialogueTree),
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
    Object.entries(schedules).filter(([key]) => this.loadedScheduleFiles.has(key)).forEach(([key, schedule]) => {
      const out = this._scheduleToGame(schedule);
      if (!out) return;
      const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = key + '.json'; a.click(); URL.revokeObjectURL(a.href);
    });
    if (this.loadedMetaFiles.has('special_events.json')) downloadJson('special_events.json', this._eventFileToGame());
    if (this.loadedMetaFiles.has('endings.json')) downloadJson('endings.json', this._endingFileToGame());
    this._closeModal(); this._st('游戏格式已导出');
  }

  async _writeGameFiles() {
    const schedules = this.project?.schedules || {};
    const files = Object.entries(schedules).filter(([key, schedule]) => this.loadedScheduleFiles.has(key) && schedule?.entries);
    const writes = files.map(([key, schedule]) => this._dev.writeToDisk(`${key}.json`, this._scheduleToGame(schedule)));
    if (this.loadedMetaFiles.has('special_events.json')) writes.push(this._dev.writeToDisk('special_events.json', this._eventFileToGame()));
    if (this.loadedMetaFiles.has('endings.json')) writes.push(this._dev.writeToDisk('endings.json', this._endingFileToGame()));
    await Promise.all(writes);
    this._st(`已写入 ${writes.length} 个文件`);
  }

  _scheduleToGame(schedule) {
    return { entries: (schedule?.entries || []).map((entry) => {
      const { day, time, ...out } = entry;
      delete out.dialogueTree;
      out.blueprint = this._ctxToBlueprint(entry.dialogueTree);
      return out;
    }) };
  }

  _metaFileToGame(fileDoc, contexts, key) {
    const source = Array.isArray(fileDoc?.[key]) ? fileDoc[key] : [];
    const byId = new Map(source.map((entry) => [entry.id, entry]));
    return { ...fileDoc, [key]: Object.entries(contexts || {}).map(([id, ctx]) => {
      const out = { ...(byId.get(id) || {}), id };
      if (ctx?.nodes && Object.keys(ctx.nodes).length) {
        delete out.dialogueTree;
        out.blueprint = this._ctxToBlueprint(ctx);
      }
      return out;
    }) };
  }

  _eventFileToGame() { return this._metaFileToGame(this.project.eventFileDoc, this.project.events, 'events'); }
  _endingFileToGame() { return this._metaFileToGame(this.project.endingFileDoc, this.project.endings, 'endings'); }

  _ctxToBlueprint(ctx) {
    const nodes = {};
    Object.values(ctx?.nodes || {}).forEach(n => {
      const node = { ...n, id: n.id, inputs: { ...(n.inputs || {}) }, outputs: { ...(n.outputs || {}) } };
      if (node.type === 'text') {
        node.inputs.speaker = node.speaker === 'player' ? 'player' : 'npc';
        node.inputs.text = node.text || '';
      }
      delete node.speaker; delete node.text; delete node.keywordIds; delete node.entryConds;
      if (node.conditions?.length) node.condition = node.conditions[0];
      nodes[node.id] = node;
    });
    const startNodeId = ctx?.startNodeId || Object.keys(nodes)[0] || null;
    const connections = Array.isArray(ctx?.connections) ? ctx.connections.map(connection => ({ ...connection })) : [];
    if (!Object.values(nodes).some(node => node.type === 'flowStart')) {
      const flowStartId = '__start';
      nodes[flowStartId] = { id: flowStartId, type: 'flowStart', inputs: {}, outputs: {}, x: 40, y: 40 };
      if (startNodeId && nodes[startNodeId]) connections.unshift({ fromNodeId: flowStartId, fromPort: 'flowOut', toNodeId: startNodeId, toPort: 'flowIn' });
      return { nodes, connections, startNodeId: flowStartId };
    }
    return { nodes, connections, startNodeId };
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


