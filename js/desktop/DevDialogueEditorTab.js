// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";
import { scheduleData } from "../core/ScheduleData.js";
import { globalVariableManager } from "../core/GlobalVariableManager.js";
import { itemManager } from "../core/ItemManager.js";
import { skillManager } from "../core/SkillManager.js";
import { MAX_GAME_DAYS } from "../core/GameRules.js";
import { SCHEDULE_NODE_TYPES, getScheduleNodeDefinition, getScheduleNodePort } from "../core/ScheduleNodeRegistry.js";
import { validateBlueprint } from "../core/ScheduleBlueprint.js";
import { windowManager } from "../core/WindowManager.js";

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
const _DE_NUMVARS = ['energy','mental','physical','satiety','recoverableMentalLoss'];
const _DE_NODE_LABELS = Object.fromEntries(SCHEDULE_NODE_TYPES.map(type => [type, getScheduleNodeDefinition(type).label]));

export class DevDialogueEditorTab {
  constructor(devMode, options = {}) {
    this._dev = devMode;
    this._workspace = options.workspace !== false;
    this._sharedProject = options.project || null;
    this._initialCtx = options.initialCtx || null;
    this._fileScope = options.fileScope || null;
    this._embeddedScope = options.embeddedScope || null;
    this._temporaryScope = options.temporaryScope || null;
    this.root = null;
    this.project = null;
    this.currentCtx = null;       // { type:'schedule'|'event'|'ending', id, entryIndex }
    this.currentQueue = 'work';
    this.loadedScheduleFiles = new Set();
    this.loadedMetaFiles = new Set();
    this.selectedNodeId = null;
    this.selectedNodeIds = new Set();
    this._boxSelect = null;
    this._blueprintClipboard = null;
    this._suppressCanvasClick = false;
    this._dragState = null;
    this._connectMode = false;
    this._connectFrom = null;     // { nodeId, optIdx }
    this.canvasZoom = 1;
    this.totalDays = MAX_GAME_DAYS;
    this.gameItems = [];
    this.gameSpells = [];
    this._inputModes = new Map();
    this._abort = null;           // AbortController for document listeners
    this._workspaceSelections = { scheduleSocial: '', scheduleWork: '', publicSocial: 'socialpub', publicWork: 'workpub', special: '', ending: '' };
  }

  // ── utilities ─────────────────────────────────────────────────────────────
  _el(id) { return this.root?.querySelector(`#${CSS.escape(id)}`) || null; }
  _e(s)   { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  _uid(p) { return `${p||'id'}_${(Date.now()+Math.random()).toString(36).slice(-6)}`; }
  _st(msg) { this._dev.setStatus(msg); }

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
    return {id:this._uid('n'),type:'text',inputs:{speaker:'player',text:''},outputs:{},x,y};
  }
  _emptyOpt() { return {id:this._uid('opt'),label:'',next:null,effects:{},conditions:[]}; }
  _emptyCtx() { return {nodes:{},connections:[],startNodeId:null}; }
  _emptyProject(totalDays = MAX_GAME_DAYS) {
    totalDays = Math.min(MAX_GAME_DAYS, Math.max(1, Number(totalDays) || MAX_GAME_DAYS));
    const schedules={};
    for (let d=1;d<=totalDays;d++) for (const queue of ['work','social']) for (const ph of ['a','b']) schedules[`${queue}${String(d).padStart(2,'0')}${ph}`]={displayName:'',entries:[]};
    schedules.socialpub = { displayName: '', entries: [] };
    schedules.workpub = { displayName: '', entries: [] };
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
  mount(root = null) {
    this.root = root || this._dev.root.querySelector('.dev-de-root');
    window._de = this;
    this.root?.addEventListener('pointerdown', () => { window._de = this; });
    this.project = this._sharedProject || this._emptyProject();
    if (this._temporaryScope) {
      const id = "__temporary_schedule__";
      this.project.schedules[id] = { displayName: "临时日程", entries: [{ id: "temporary_entry", type: "other", name: "临时日程", dialogueTree: this._temporaryScope.blueprint || this._temporaryBlueprint() }] };
      this.currentCtx = { type: "schedule", id, entryIndex: 0 };
    }
    this.loadedScheduleFiles = new Set(this._sharedProject ? Object.keys(this.project.schedules || {}) : []);
    this.loadedMetaFiles = new Set(this._sharedProject ? ['special_events.json', 'endings.json'] : []);
    if (this._sharedProject || this._temporaryScope) {
      if (this._initialCtx) this.currentCtx = this._initialCtx;
      this._renderCanvas();
      if (this.currentCtx) this._selectCtx(this.currentCtx.type, this.currentCtx.id, this.currentCtx.entryIndex || 0);
    } else if (this._workspace) {
      this.currentCtx = this._initialCtx;
      this._loadCurrentGame();
    }
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
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c') { e.preventDefault(); this._copySelectedNodes(); }
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v') { e.preventDefault(); this._pasteSelectedNodes(); }
      if (e.key==='Delete' && this.selectedNodeIds.size) { e.preventDefault(); this._deleteSelectedNodes(); }
    }, {signal:sig});
    if (!this._workspace) this._renderScopedSidebar();
    else this._renderWorkspace();
  }
  unmount() {
    if (window._de === this) window._de = null;
    if (this._abort) { this._abort.abort(); this._abort = null; }
  }

  // ── HTML skeleton ─────────────────────────────────────────────────────────
  html() { return this._embeddedScope ? this._embeddedHtml() : this._standardHtml(); }
  _temporaryBlueprint() {
    return { startNodeId: "start", nodes: {
      start: { id: "start", type: "flowStart", inputs: {}, outputs: {}, x: 80, y: 80 },
      text: { id: "text", type: "text", inputs: { speaker: "narrator", text: "" }, outputs: {}, x: 320, y: 80 },
      end: { id: "end", type: "scheduleEnd", inputs: {}, outputs: {}, x: 560, y: 80 },
    }, connections: [
      { fromNodeId: "start", fromPort: "flowOut", toNodeId: "text", toPort: "flowIn" },
      { fromNodeId: "text", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
    ] };
  }
  _embeddedHtml() {
    // Embedded blueprints are mounted inside another editor. They keep the
    // normal toolbar, canvas and right node editor, but must not expose the
    // project-level schedule sidebar or its unrelated file controls.
    const html = this._standardHtml();
    return html
      .replace(
        /<div class="dev-de-header">[\s\S]*?<\/div>\n<div class="dev-de-main">/,
        `<div class="dev-de-header"><strong>${this._e(this._embeddedScope.title || '内嵌日程表')}</strong><button type="button" class="win95-btn dev-btn" onclick="_de._saveProject()">💾 保存内嵌日程</button></div>\n<div class="dev-de-main">`
      )
      .replace(/  <!-- Sidebar -->[\s\S]*?  <!-- Canvas -->/, '  <!-- Canvas -->');
  }
  _standardHtml() {
    if (this._temporaryScope) {
      return this._standardHtmlBase().replace(
        /<div class="dev-de-header">[\s\S]*?<\/div>\n<div class="dev-de-main">/,
        `<div class="dev-de-header"><strong>临时日程编辑器</strong><button type="button" class="win95-btn dev-btn" onclick="_de._saveProject()">💾 保存并插入队列</button></div>\n<div class="dev-de-main">`
      );
    }
    return this._standardHtmlBase();
  }
  _standardHtmlBase() {
    if (this._workspace) return this._workspaceHtml();
    const nodeShortcut = (index) => `<label class="dev-de-node-type-label">节点类型
        <select id="de-new-node-type-${index}" class="dev-de-node-type">
          ${SCHEDULE_NODE_TYPES.map(type=>`<option value="${type}">${this._e(_DE_NODE_LABELS[type])} (${type})</option>`).join('')}
        </select>
      </label><button type="button" class="win95-btn dev-btn" onclick="_de.addNode(document.getElementById('de-new-node-type-${index}').value)">＋ 新增日程节点</button>`;
    const nodeShortcuts = [1, 2, 3].map(nodeShortcut).join('');
    return `<div class="dev-de-root">
<div class="dev-de-header">
  <button type="button" class="win95-btn dev-btn" onclick="_de._loadScopedCurrentGame()">⬇ 从当前游戏读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._loadScopedFile()">📂 从文件读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._exportScopedFile()">📤 导出 JSON</button>
  <button type="button" class="win95-btn dev-btn" onclick="_de._writeScopedFile()">💽 写入磁盘</button>
  <input type="file" id="de-scoped-file-input" accept=".json" style="display:none" onchange="_de._onScopedFile(event)">
</div>
<div class="dev-de-main">
  <!-- Sidebar -->
  <div class="dev-de-sidebar">
    <div id="de-schedule-tools" class="dev-de-sidebar-tools">
      <button type="button" class="win95-btn dev-btn" onclick="_de._addScheduleEntry()">＋ 日程条目</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._deleteScheduleEntry()">🗑 删除日程条目</button>
    </div>
    <div id="de-sidebar-inner" style="flex:1;overflow-y:auto;padding:4px">
      <div class="dev-de-sb-sec">
        <div class="dev-de-sb-title">📄 日程文件</div>
        <div id="de-sb-file-entries"></div>
      </div>
    </div>
  </div>
  <!-- Canvas -->
  <div class="dev-de-canvas-wrap">
    <div class="dev-de-canvas-toolbar">
      ${nodeShortcuts}
      <button type="button" class="win95-btn dev-btn" onclick="_de._autoLayout()">🔧 自动排布</button>

      <button type="button" class="win95-btn dev-btn" onclick="_de._deleteSelectedNodes()">🗑 删选中</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._copySelectedNodes()">📋 复制选中</button>
      <button type="button" class="win95-btn dev-btn" onclick="_de._pasteSelectedNodes()">📌 粘贴</button>
      <span class="dev-de-zoom-tools"><button type="button" class="win95-btn dev-btn" onclick="_de._setCanvasZoom(-0.1)">－</button><span id="de-canvas-zoom">100%</span><button type="button" class="win95-btn dev-btn" onclick="_de._setCanvasZoom(0.1)">＋</button></span>
    </div>
    <div id="de-canvas-container" class="dev-de-canvas-container" onclick="_de._onCanvasClick(event)" onpointerdown="_de._beginBoxSelect(event)">
      <div id="de-canvas-content" class="dev-de-canvas-content">
        <svg id="de-canvas-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible" width="2000" height="1200"></svg>
        <div id="de-canvas-nodes" style="position:absolute;top:0;left:0;min-width:2000px;min-height:1200px"></div>
      </div>
    </div>
  </div>
  <!-- Editor panel -->
  <div class="dev-de-editor">
    <div class="dev-de-editor-title">日程节点编辑器</div>
    <div id="de-editor-body" style="flex:1;overflow-y:auto;padding:6px">
      <div id="de-editor-empty" style="padding:10px;color:#555;font-size:12px"><div id="de-context-settings"></div><div style="margin-top:12px;text-align:center">选择节点后在此编辑节点；当前日程属性可直接在上方编辑。</div></div>
      <div id="de-editor-form" style="display:none">
        <div>
          <div class="dev-de-ed-label" id="de-ed-type-label">节点</div>
          <div class="dev-de-ed-label" style="margin-top:4px">数值输入</div>
          <div id="de-ed-inputs"></div>
          <div class="dev-de-ed-label" style="margin-top:8px">流程输出（选择下家）</div>
          <div id="de-flow-outputs"></div>
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


  _workspaceHtml() {
    return `<div class="dev-de-root dev-schedule-workspace"><div class="dev-de-header"><strong class="dev-schedule-title">日程蓝图工作台</strong><input type="file" id="de-game-input" accept=".json" style="display:none" onchange="_de._onWorkspaceFile(event)"><span class="dev-schedule-help">每次操作只针对当前选中的一个 JSON 文件；编辑按钮会打开独立蓝图窗口。</span></div><div id="de-workspace-tables" class="dev-schedule-tables"></div></div>`;
  }

  _workspaceTable(type, title, options, selected) {
    const files = options.map(([id, label]) => `<button type="button" class="dev-schedule-file${id === selected ? ' active' : ''}" data-ws-select="${type}" data-ws-id="${this._e(id)}">${this._e(label)}</button>`).join('');
    return `<section class="dev-schedule-table"><h3>${title}</h3><div class="dev-schedule-file-list">${files || '<span class="dev-schedule-file-label">暂无文件</span>'}</div><div class="dev-schedule-actions"><button type="button" class="win95-btn dev-btn" data-ws-edit="${type}">✎ 编辑当前文件</button><button type="button" class="win95-btn dev-btn" data-ws-current="${type}">⬇ 从当前游戏读取</button><button type="button" class="win95-btn dev-btn" data-ws-file="${type}">📂 从文件读取</button><button type="button" class="win95-btn dev-btn" data-ws-export="${type}">📤 导出 JSON</button><button type="button" class="win95-btn dev-btn" data-ws-write="${type}">💽 写入磁盘</button></div></section>`;
  }

  _renderWorkspace() {
    const el = this._el('de-workspace-tables'); if (!el || !this.project) return;
    const schedules = Object.keys(this.project.schedules || {});
    const groups = { scheduleSocial: schedules.filter(id => /^social\d{2}[ab]$/.test(id)), scheduleWork: schedules.filter(id => /^work\d{2}[ab]$/.test(id)), publicSocial: ['socialpub'], publicWork: ['workpub'], special: Object.keys(this.project.events || {}), ending: Object.keys(this.project.endings || {}) };
    const titles = { scheduleSocial: '📄 Social 日程文件', scheduleWork: '📄 Work 日程文件', publicSocial: '🌐 公共 Social 日程表', publicWork: '🌐 公共 Work 日程表', special: '🎪 特殊事件日程表', ending: '🏁 结局日程表' };
    this._workspaceSelections ||= { scheduleSocial: '', scheduleWork: '', publicSocial: 'socialpub', publicWork: 'workpub', special: '', ending: '' };
    for (const type of ['scheduleSocial', 'scheduleWork']) if (!this._workspaceSelections[type] || !groups[type].includes(this._workspaceSelections[type])) this._workspaceSelections[type] = groups[type][0] || `${type === 'scheduleSocial' ? 'social' : 'work'}01a`;
    for (const type of ['publicSocial', 'publicWork', 'special', 'ending']) if (!this._workspaceSelections[type] || !groups[type].includes(this._workspaceSelections[type])) this._workspaceSelections[type] = groups[type][0] || '';
    el.innerHTML = Object.entries(groups).map(([type, list]) => this._workspaceTable(type, titles[type], list.map(id => [id, id]), this._workspaceSelections[type])).join('');
    el.querySelectorAll('[data-ws-select]').forEach(node => node.addEventListener('click', () => { this._workspaceSelections[node.dataset.wsSelect] = node.dataset.wsId; this._renderWorkspace(); }));
    el.querySelectorAll('[data-ws-edit]').forEach(node => node.addEventListener('click', () => this._openWorkspaceBlueprint(node.dataset.wsEdit)));
    el.querySelectorAll('[data-ws-current]').forEach(node => node.addEventListener('click', () => this._loadWorkspaceFile(node.dataset.wsCurrent)));
    el.querySelectorAll('[data-ws-file]').forEach(node => node.addEventListener('click', () => { const input = this._el('de-game-input'); input.dataset.wsType = node.dataset.wsFile; input.click(); }));
    el.querySelectorAll('[data-ws-export]').forEach(node => node.addEventListener('click', () => this._exportWorkspaceEntry(node.dataset.wsExport)));
    el.querySelectorAll('[data-ws-write]').forEach(node => node.addEventListener('click', () => this._writeWorkspaceEntry(node.dataset.wsWrite)));
  }

  _workspaceContext(type) { const id = this._workspaceSelections[type]; if (!id) return null; return type === 'special' ? { type: 'event', id, entryIndex: 0 } : type === 'ending' ? { type: 'ending', id, entryIndex: 0 } : { type: 'schedule', id, entryIndex: 0 }; }
  _openWorkspaceBlueprint(type) {
    const ctx = this._workspaceContext(type); if (!ctx) return this._st('当前文件暂无可编辑条目');
    if (ctx.type === 'schedule' && !this.project.schedules[ctx.id]) this.project.schedules[ctx.id] = { displayName: '', entries: [] };
    const host = document.createElement('div'); const fileName = ctx.type === 'event' ? 'special_events.json' : ctx.type === 'ending' ? 'endings.json' : `${ctx.id}.json`; const child = new DevDialogueEditorTab(this._dev, { workspace: false, project: this.project, initialCtx: ctx, fileScope: { fileName, type: ctx.type } });
    const win = windowManager.createWindow({ title: `蓝图编辑器 · ${ctx.id}`, icon: '🧩', width: Math.max(500, window.innerWidth - 20), height: Math.max(300, window.innerHeight - 20), x: 0, y: 0, content: host, onClose: () => child.unmount() });
    win.el?.classList.add('dev-blueprint-window');
    host.innerHTML = child.html(); child.mount(host.querySelector('.dev-de-root')); win.el?.addEventListener('remove', () => child.unmount(), { once: true });
  }
  _workspaceDoc(type) { const id = this._workspaceSelections[type]; if (type === 'special') return ['special_events.json', this._eventFileToGame()]; if (type === 'ending') return ['endings.json', this._endingFileToGame()]; return id ? [`${id}.json`, this._scheduleToGame(this.project.schedules[id])] : null; }
  _exportWorkspaceEntry(type) { const doc = this._workspaceDoc(type); if (doc) { downloadJson(doc[0], doc[1]); this._st(`已导出 ${doc[0]}`); } }
  async _writeWorkspaceEntry(type) { const doc = this._workspaceDoc(type); if (doc) await this._dev.writeToDisk(doc[0], doc[1]); }
  async _loadWorkspaceFile(type) {
    const doc = this._workspaceDoc(type); if (!doc) return this._st('当前文件暂无内容');
    try { const data = await dataLoader.loadJSON(doc[0]); this._applyGameDocument(doc[0], data, type); this._saveLS(); this._renderWorkspace(); this._st(`已从当前游戏读取 ${doc[0]}`); }
    catch (error) { this._st(`读取失败：${error.message}`, true); }
  }
  _applyGameDocument(fileName, data, type = null) {
    const base = fileName.replace(/\.json$/i, '');
    const kind = type || (fileName === 'special_events.json' ? 'special' : fileName === 'endings.json' ? 'ending' : base.startsWith('social') ? 'scheduleSocial' : 'scheduleWork');
    if (kind === 'special' || fileName === 'special_events.json') {
      if (!Array.isArray(data.events)) throw new Error('special_events.json 缺少 events 数组');
      this.project.eventFileDoc = data; this.project.events = Object.fromEntries(data.events.map(entry => [entry.id, this._normalizeGameTree(entry.blueprint || entry.dialogueTree)])); this.loadedMetaFiles.add('special_events.json'); this._workspaceSelections.special = Object.keys(this.project.events)[0] || '';
    } else if (kind === 'ending' || fileName === 'endings.json') {
      if (!Array.isArray(data.endings)) throw new Error('endings.json 缺少 endings 数组');
      this.project.endingFileDoc = data; this.project.endings = Object.fromEntries(data.endings.map(entry => [entry.id, this._normalizeGameTree(entry.blueprint || entry.dialogueTree)])); this.loadedMetaFiles.add('endings.json'); this._workspaceSelections.ending = Object.keys(this.project.endings)[0] || '';
    } else {
      if (!Array.isArray(data.entries)) throw new Error(`${fileName} 缺少 entries 数组`);
      this.project.schedules[base] = { ...data, entries: data.entries.map(entry => ({ ...entry, dialogueTree: this._normalizeGameTree(entry.blueprint || entry.dialogueTree) })) };
      this.loadedScheduleFiles.add(base); this._workspaceSelections[kind] = base;
    }
  }
  _scopedDocument() {
    const scope = this._fileScope; if (!scope?.fileName) return null;
    if (scope.type === 'event') return [scope.fileName, this._eventFileToGame()];
    if (scope.type === 'ending') return [scope.fileName, this._endingFileToGame()];
    const id = scope.fileName.replace(/\.json$/i, ''); return [scope.fileName, this._scheduleToGame(this.project.schedules?.[id])];
  }
  async _loadScopedCurrentGame() {
    const doc = this._scopedDocument(); if (!doc) return;
    try { const data = await dataLoader.loadJSON(doc[0]); this._applyGameDocument(doc[0], data, this._fileScope.type === 'event' ? 'special' : this._fileScope.type === 'ending' ? 'ending' : null); this.currentCtx = this._initialCtx || this.currentCtx; this._renderScopedSidebar(); this._renderCanvas(); this._st(`已从当前游戏读取 ${doc[0]}`); }
    catch (error) { this._st(`读取失败：${error.message}`, true); }
  }
  _loadScopedFile() { this._el('de-scoped-file-input')?.click(); }
  _onScopedFile(ev) { const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { this._applyGameDocument(this._fileScope.fileName, JSON.parse(reader.result), this._fileScope.type === 'event' ? 'special' : this._fileScope.type === 'ending' ? 'ending' : null); this._renderScopedSidebar(); this._renderCanvas(); this._st(`已从文件读取 ${this._fileScope.fileName}`); } catch (error) { this._st(`读取失败：${error.message}`, true); } }; reader.readAsText(file, 'utf-8'); }
  _validateCurrentBlueprint() {
    const data = this._ctxData();
    if (!data) return true;
    const result = validateBlueprint(data);
    if (!result.ok) { alert(`蓝图校验失败：\n${result.errors.join('\n')}`); return false; }
    return true;
  }
  _exportScopedFile() { if (!this._validateCurrentBlueprint()) return; const doc = this._scopedDocument(); if (doc) { downloadJson(doc[0], doc[1]); this._st(`已导出 ${doc[0]}`); } }
  async _writeScopedFile() { if (!this._validateCurrentBlueprint()) return; const doc = this._scopedDocument(); if (doc) await this._dev.writeToDisk(doc[0], doc[1]); }
  _onWorkspaceFile(ev) {
    const file = ev.target.files?.[0], type = ev.target.dataset.wsType; ev.target.value = ''; if (!file || !type) return;
    const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result);
      if (type === 'special' || type === 'ending') { const key = type === 'special' ? 'events' : 'endings'; if (!Array.isArray(data[key])) throw new Error(`${key} 必须是数组`); const target = type === 'special' ? this.project.events : this.project.endings; if (type === 'special') this.project.eventFileDoc = data; else this.project.endingFileDoc = data; data[key].forEach(entry => { if (!entry?.id) throw new Error('条目缺少 id'); target[entry.id] = this._normalizeGameTree(entry.blueprint || entry.dialogueTree); }); this.loadedMetaFiles.add(type === 'special' ? 'special_events.json' : 'endings.json'); }
      else { if (!Array.isArray(data.entries)) throw new Error('日程文件缺少 entries 数组'); const id = this._workspaceSelections[type]; this.project.schedules[id] = { ...data, entries: data.entries.map(entry => ({ ...entry, dialogueTree: this._normalizeGameTree(entry.blueprint || entry.dialogueTree) })) }; this.loadedScheduleFiles.add(id); }
      this._saveLS(); this._renderWorkspace(); this._st(`已读取 ${file.name}`);
    } catch (error) { this._st(`读取失败：${error.message}`, true); } }; reader.readAsText(file, 'utf-8');
  }

  // ── sidebar ───────────────────────────────────────────────────────────────
  _renderScopedSidebar() {
    const dayEl = this._el('de-sb-file-entries');
    const scheduleTools = this._el('de-schedule-tools');
    const scope = this._fileScope;
    if (!dayEl) return;
    const fileName = scope?.fileName || '';
    const base = fileName.replace(/\.json$/i, '');
    const isSchedule = scope?.type === 'schedule';
    if (scheduleTools) scheduleTools.style.display = isSchedule ? '' : 'none';
    const section = dayEl.closest('.dev-de-sb-sec');
    const title = section?.querySelector('.dev-de-sb-title');
    if (title) title.textContent = `📄 ${fileName} 日程列表`;
    if (isSchedule) {
      const entries = this.project.schedules?.[base]?.entries || [];
      dayEl.innerHTML = entries.map((entry, index) => `<div class="dev-de-sb-item${this.currentCtx?.entryIndex === index ? ' active' : ''}" onclick="_de._selectSchedule('${this._e(base)}',${index})"><span>${this._e(entry.name || entry.npcId || entry.id || `条目 ${index + 1}`)}</span><span class="dev-de-sb-actions"><button type="button" class="dev-de-sb-copy" onclick="event.stopPropagation();_de._selectSchedule('${this._e(base)}',${index});_de._copyEntry('schedule',${index})" title="复制日程">＋</button><button type="button" class="dev-de-sb-del" onclick="event.stopPropagation();_de._selectSchedule('${this._e(base)}',${index});_de._deleteEntry('schedule',${index})" title="删除日程">−</button></span></div>`).join('') || '<div class="dev-de-sb-empty">暂无条目</div>';
      return;
    }
    const key = scope?.type === 'event' ? 'events' : 'endings';
    const doc = scope?.type === 'event' ? this.project.eventFileDoc : this.project.endingFileDoc;
    const entries = Array.isArray(doc?.[key]) ? doc[key] : [];
    dayEl.innerHTML = entries.map(entry => `<div class="dev-de-sb-item${this.currentCtx?.id === entry.id ? ' active' : ''}" onclick="_de._selectCtx('${this._e(scope?.type)}','${this._e(entry.id)}')"><span>${this._e(entry.title || entry.name || entry.id)}</span></div>`).join('') || '<div class="dev-de-sb-empty">暂无条目</div>';
  }

  _selectSchedule(id, entryIndex = 0) {
    this.currentQueue = id.startsWith('social') ? 'social' : 'work';
    const schedule = this.project.schedules?.[id] || { entries: [] };
    this.project.schedules[id] ||= schedule;
    this._selectCtx('schedule', id, schedule.entries.length ? Math.min(entryIndex, schedule.entries.length - 1) : 0);
  }

  _selectCtx(type, id, entryIndex = 0) {
    this.currentCtx = {type, id, entryIndex};
    this.selectedNodeId = null;
    this.selectedNodeIds.clear();
    this._renderScopedSidebar();
    this._renderCanvas();
    const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
    this._renderContextSettings();
 }

 _currentEntry() {
   if (!this.currentCtx || !this.project) return null;
   if (this.currentCtx.type === 'schedule') return this.project.schedules?.[this.currentCtx.id]?.entries?.[this.currentCtx.entryIndex] || null;
   const key = this.currentCtx.type === 'event' ? 'events' : 'endings';
   const doc = this.currentCtx.type === 'event' ? this.project.eventFileDoc : this.project.endingFileDoc;
   return (Array.isArray(doc?.[key]) ? doc[key] : []).find((entry) => entry.id === this.currentCtx.id) || null;
 }

 _renderContextSettings() {
   const el = this._el('de-context-settings'); if (!el) return;
   const entry = this._currentEntry();
   if (!entry) { el.innerHTML = '<div style="color:#888">当前文件暂无日程条目，请先新增日程条目。</div>'; return; }
   const displayName = this.currentCtx.type === 'ending' ? (entry.displayName || entry.title || '') : (entry.displayName || entry.name || '');
   el.innerHTML = `<div class="dev-de-context-settings"><strong>当前日程属性</strong><label>日程 ID<input data-de-schedule-id value="${this._e(entry.id || '')}"></label><label>显示名称<input data-de-schedule-display-name value="${this._e(displayName)}"></label><div class="dev-de-input-help">这里只修改当前日程条目的 ID 和显示名称，不修改日程表文件名。</div></div>`;
   el.querySelector('[data-de-schedule-id]')?.addEventListener('change', event => this._saveScheduleMeta('id', event.target.value));
   el.querySelector('[data-de-schedule-display-name]')?.addEventListener('input', event => this._saveScheduleMeta('displayName', event.target.value));
 }

 _saveScheduleMeta(field, value) {
   const entry = this._currentEntry();
   if (!entry) return;
   const oldId = entry.id;
   if (field === 'id') {
     const id = String(value || '').trim();
     const entries = this.currentCtx.type === 'schedule' ? (this.project.schedules[this.currentCtx.id]?.entries || []) : (this.currentCtx.type === 'event' ? (this.project.eventFileDoc?.events || []) : (this.project.endingFileDoc?.endings || []));
     if (!id || (id !== oldId && entries.some((candidate) => candidate.id === id))) { this._st('日程 ID 不能为空且不能重复'); this._renderContextSettings(); return; }
     entry.id = id;
     if (this.currentCtx.type !== 'schedule') {
       const collection = this.currentCtx.type === 'event' ? this.project.events : this.project.endings;
       collection[id] = collection[oldId]; delete collection[oldId];
       this.currentCtx.id = id;
     }
   } else if (this.currentCtx.type === 'ending') { entry.displayName = String(value ?? ''); entry.title = entry.displayName; }
   else { entry.displayName = String(value ?? ''); entry.name = entry.displayName; }
   this._saveLS(); this._renderScopedSidebar(); this._renderCanvas(); this._renderContextSettings();
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

  _cloneBlueprintValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  _uniqueEntryId(base, entries) {
    const used = new Set((entries || []).map(entry => entry.id));
    let id = `${base || 'schedule'}_copy`;
    let index = 2;
    while (used.has(id)) id = `${base || 'schedule'}_copy_${index++}`;
    return id;
  }

  _copyEntry(type, key) {
    const isSchedule = type === 'schedule';
    const collection = isSchedule
      ? this.project.schedules?.[this.currentCtx?.id]?.entries
      : (type === 'event' ? this.project.eventFileDoc?.events : this.project.endingFileDoc?.endings);
    const source = isSchedule ? collection?.[key] : collection?.find(entry => entry.id === key);
    if (!source) return;
    const clone = this._cloneBlueprintValue(source);
    clone.id = this._uniqueEntryId(source.id, collection);
    if (type === 'ending') clone.title = clone.displayName || `${clone.title || clone.id} 副本`;
    else clone.name = clone.displayName || `${clone.name || clone.id} 副本`;
    if (isSchedule) {
      clone.dialogueTree = this._cloneBlueprintValue(source.dialogueTree || this._emptyCtx());
      collection.push(clone);
      this.loadedScheduleFiles.add(this.currentCtx.id);
      this._saveLS();
      this._selectSchedule(this.currentCtx.id, collection.length - 1);
      return;
    }
    collection.push(clone);
    const contexts = type === 'event' ? this.project.events : this.project.endings;
    contexts[clone.id] = this._cloneBlueprintValue(contexts[source.id] || this._emptyCtx());
    this.loadedMetaFiles.add(type === 'event' ? 'special_events.json' : 'endings.json');
    this._saveLS();
    this._selectCtx(type, clone.id);
  }

  _deleteEntry(type, key) {
    if (type === 'schedule') { this._deleteScheduleEntry(); return; }
    const collection = type === 'event' ? this.project.eventFileDoc?.events : this.project.endingFileDoc?.endings;
    const source = collection?.find(entry => entry.id === key);
    if (!source || !confirm(`确认删除日程“${source.name || source.title || key}”？`)) return;
    collection.splice(collection.indexOf(source), 1);
    const contexts = type === 'event' ? this.project.events : this.project.endings;
    delete contexts[key];
    this.loadedMetaFiles.add(type === 'event' ? 'special_events.json' : 'endings.json');
    if (this.currentCtx?.id === key) this.currentCtx = null;
    this._saveLS(); this._renderScopedSidebar(); this._renderCanvas();
  }

  _deleteCtx(type, id) {
    if (!confirm(`确认删除 ${type} "${id}"？`)) return;
    if (type==='event')  { delete this.project.events[id]; this.loadedMetaFiles.add('special_events.json'); }
    if (type==='ending') { delete this.project.endings[id]; this.loadedMetaFiles.add('endings.json'); }
    if (this.currentCtx?.id===id) { this.currentCtx=null; this._renderCanvas(); }
    this._renderScopedSidebar(); this._saveLS();
  }

  // ── canvas ────────────────────────────────────────────────────────────────
  _ensureArrowMarker() {
    const svg=this._el('de-canvas-svg'); if(!svg) return;
    if (svg.querySelector('#de-arrow')) return;
    const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML=`<marker id="de-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#000080"/></marker>`;
    svg.appendChild(defs);
  }

  _setCanvasZoom(delta) {
    this.canvasZoom = Math.min(2, Math.max(0.5, Math.round((this.canvasZoom + Number(delta)) * 10) / 10));
    this._applyCanvasZoom();
  }

  _applyCanvasZoom() {
    const content = this._el('de-canvas-content');
    if (!content) return;
    const zoom = this.canvasZoom;
    content.style.width = `${2000 * zoom}px`;
    content.style.height = `${1200 * zoom}px`;
    content.style.transform = `scale(${zoom})`;
    content.style.transformOrigin = 'top left';
    const label = this._el('de-canvas-zoom');
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  }

  _renderCanvas() {
    this._ensureArrowMarker();
    const data=this._ctxData();
    const container=this._el('de-canvas-nodes');
    if (!container) return;
    if (!data) { container.innerHTML=''; const s=this._el('de-canvas-svg'); if(s) Array.from(s.children).filter(c=>c.tagName!=='defs').forEach(c=>c.remove()); return; }
    this._renderNodes(data, container);
    this._drawArrows(data);
    this._applyCanvasZoom();
  }

  _portsFor(node, direction) {
    const def = getScheduleNodeDefinition(node.type || 'text') || {};
    const ports = direction === 'input' ? [...(def.flowInputs || []), ...(def.valueInputs || [])] : [...(def.flowOutputs || []), ...(def.valueOutputs || [])];
    const choiceCount = Math.max(0, Math.min(32, Number.isInteger(Number(node.inputs?.branchCount)) ? Number(node.inputs.branchCount) : (node.options || []).length));
    if (node.type === 'choice' && direction === 'output') {
      for (let index = 0; index < choiceCount; index += 1) ports.push({ name: `option${index}`, kind: 'flow', type: null });
    }
    if (node.type === 'choice' && direction === 'input') {
      for (let index = 0; index < choiceCount; index += 1) ports.push({ name: `label${index}`, kind: 'value', type: 'string' });
    }
    if (node.type === 'segmentBranch') {
      const count = Math.max(1, Math.min(32, Number.isInteger(Number(node.inputs?.branchCount)) ? Number(node.inputs.branchCount) : 1));
      if (direction === 'output') return [{ name: 'segment0', kind: 'flow', type: null }, ...Array.from({ length: count - 1 }, (_, index) => ({ name: `segment${index + 1}`, kind: 'flow', type: null }))];
      return [
        { name: 'flowIn', kind: 'flow', type: null },
        { name: 'value', kind: 'value', type: 'number' },
        { name: 'branchCount', kind: 'value', type: 'number' },
        ...Array.from({ length: count + 1 }, (_, index) => ({ name: `boundary${index}`, kind: 'value', type: 'number' })),
      ];
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
      const nodeLabel=_DE_NODE_LABELS[node.type||'text']||'显示文字';
      const isStart=node.id===data.startNodeId, isSel=node.id===this.selectedNodeId || this.selectedNodeIds.has(node.id);
      const div=document.createElement('div');
      div.className=`dev-de-node${isSel?' selected':''}${isStart?' start':''}`;
      div.id=`de-node-${node.id}`;
      div.dataset.nodeId=node.id;
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
        <div class="dev-de-node-hd" style="background:#000080">
          <span>${this._e(nodeLabel)}${isStart?' 🏠':''}</span>
          <button type="button" class="dev-de-node-link" onclick="event.stopPropagation();_de._startConnect('${node.id}',null)" title="连线">🔗</button>
        </div>
        <div class="dev-de-node-body">${this._e(JSON.stringify(node.inputs||{}))}</div>
        <div class="dev-de-port-layer inputs">${this._portMarkup(node, 'input')}</div>
        <div class="dev-de-port-layer outputs">${this._portMarkup(node, 'output')}</div>
        <div class="dev-de-node-ft"><span class="dev-de-nbadge">${this._e(node.type || 'unknown')}</span>${optBadge}${nxtBadge}${bgmBadge}</div>`;
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
        const additive = e.ctrlKey || e.metaKey;
        if (additive) {
          if (!this.selectedNodeIds.size && this.selectedNodeId) this.selectedNodeIds.add(this.selectedNodeId);
          if (this.selectedNodeIds.has(node.id)) this.selectedNodeIds.delete(node.id);
          else this.selectedNodeIds.add(node.id);
          this.selectedNodeId = this.selectedNodeIds.size === 1 ? [...this.selectedNodeIds][0] : null;
          this.root?.querySelectorAll('.dev-de-node').forEach(item => item.classList.toggle('selected', this.selectedNodeIds.has(item.dataset.nodeId)));
          if (this.selectedNodeId) this._loadNodeEditor();
          else {
            const empty=this._el('de-editor-empty'), form=this._el('de-editor-form');
            if(empty) empty.style.display=''; if(form) form.style.display='none';
          }
          return;
        }
        const hitNodeIds = [...new Set((document.elementsFromPoint?.(e.clientX, e.clientY) || [])
          .map(element => element.closest?.('.dev-de-node')?.dataset.nodeId)
          .filter(Boolean))];
        const selectedHitId = hitNodeIds.find(id => this.selectedNodeIds.has(id));
        const interactionNode = data.nodes[selectedHitId] || node;
        if (!this.selectedNodeIds.has(interactionNode.id)) this.selectedNodeIds = new Set([interactionNode.id]);
        this.selectedNodeId=interactionNode.id;
        this.root?.querySelectorAll('.dev-de-node').forEach(item => item.classList.toggle('selected', this.selectedNodeIds.has(item.dataset.nodeId)));
        this._loadNodeEditor();
        const sx=e.clientX, sy=e.clientY;
        const dragIds = [...this.selectedNodeIds];
        const origins = new Map(dragIds.map(id => {
          const selected = data.nodes[id];
          return [id, { x: selected?.x ?? 60, y: selected?.y ?? 60 }];
        }));
        let moved=false;
        const onMove=mv=>{
          moved=true;
          const dx=(mv.clientX-sx)/this.canvasZoom, dy=(mv.clientY-sy)/this.canvasZoom;
          dragIds.forEach(id=>{
            const selected=data.nodes[id], origin=origins.get(id), selectedEl=this.root?.querySelector(`#de-node-${CSS.escape(id)}`);
            if (!selected || !origin) return;
            selected.x=Math.max(0, origin.x+dx); selected.y=Math.max(0, origin.y+dy);
            if (selectedEl) { selectedEl.style.left=selected.x+'px'; selectedEl.style.top=selected.y+'px'; }
          });
          this._drawArrows(data);
        };
        const onUp=()=>{ document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); this._dragState=null; if(moved) this._saveLS(); };
        this._dragState={nodeIds:dragIds};
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
    const sx=wrap?wrap.scrollLeft:0, sy=wrap?wrap.scrollTop:0, zoom=this.canvasZoom;
    const arc=(fId,tId,color,dashed,sourceEl=null,targetPort=null)=>{
      const fEl=this.root?.querySelector(`#de-node-${CSS.escape(fId)}`), tEl=this.root?.querySelector(`#de-node-${CSS.escape(tId)}`);
      if(!fEl||!tEl) return;
      const fr=fEl.getBoundingClientRect(), tr=tEl.getBoundingClientRect();
      const sourceRect=sourceEl?.getBoundingClientRect();
      const targetEl=targetPort ? tEl.querySelector(`[data-port="${CSS.escape(targetPort)}"]`) : null;
      const targetRect=targetEl?.getBoundingClientRect();
      let x1=sourceRect ? sourceRect.left-wr.left+sourceRect.width/2+sx : fr.left-wr.left+fr.width+sx;
      let y1=sourceRect ? sourceRect.top-wr.top+sourceRect.height/2+sy : fr.top-wr.top+fr.height/2+sy;
      let x2=targetRect ? targetRect.left-wr.left+targetRect.width/2+sx : tr.left-wr.left+sx;
      let y2=targetRect ? targetRect.top-wr.top+targetRect.height/2+sy : tr.top-wr.top+tr.height/2+sy;
      x1 /= zoom; y1 /= zoom; x2 /= zoom; y2 /= zoom;
      const dx=Math.max(40,Math.abs(x2-x1)/2);
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`);
      p.setAttribute('stroke',color||'#000080'); p.setAttribute('stroke-width','2');
      p.setAttribute('fill','none'); p.setAttribute('marker-end','url(#de-arrow)');
      if(dashed) p.setAttribute('stroke-dasharray','5,3');
      svg.appendChild(p);
    };
    (data.connections||[]).forEach(connection=>{
      if(connection.fromNodeId && connection.toNodeId) {
        const source = this.root?.querySelector(`#de-node-${CSS.escape(connection.fromNodeId)}`)?.querySelector(`[data-port="${CSS.escape(connection.fromPort || '')}"]`);
        const sourcePort = getScheduleNodePort(data.nodes[connection.fromNodeId]?.type, connection.fromPort, 'output', data.nodes[connection.fromNodeId]);
        const color = sourcePort?.kind === 'value' ? '#08752d' : '#b00000';
        arc(connection.fromNodeId, connection.toNodeId, color, false, source, connection.toPort);
      }
    });
  }

  _drawTempConnection(source, clientX, clientY) {
    const svg=this._el('de-canvas-svg'), wrap=this._el('de-canvas-container');
    if(!svg||!wrap||!source) return;
    const wr=wrap.getBoundingClientRect(), sx=wrap.scrollLeft, sy=wrap.scrollTop, zoom=this.canvasZoom;
    const sr=source.getBoundingClientRect();
    const x2=(clientX-wr.left+sx)/zoom, y2=(clientY-wr.top+sy)/zoom;
    const x1Raw=sr.left-wr.left+sr.width/2+sx, y1Raw=sr.top-wr.top+sr.height/2+sy;
    const x1=x1Raw/zoom, y1=y1Raw/zoom;
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

  _canvasPoint(e) {
    const wrap = this._el('de-canvas-container');
    const rect = wrap.getBoundingClientRect();
    return { x: (e.clientX - rect.left + wrap.scrollLeft) / this.canvasZoom, y: (e.clientY - rect.top + wrap.scrollTop) / this.canvasZoom };
  }

  _beginBoxSelect(e) {
    if (e.button !== 0 || this._connectMode || e.target.closest('.dev-de-node, .dev-de-port-pin, button')) return;
    const content = this._el('de-canvas-content');
    if (!content) return;
    e.preventDefault();
    e.stopPropagation();
    const start = this._canvasPoint(e);
    const additive = e.ctrlKey || e.metaKey;
    const box = document.createElement('div');
    box.className = 'dev-de-selection-box';
    content.appendChild(box);
    this._boxSelect = { start, box };
    const update = event => {
      const point = this._canvasPoint(event);
      const left = Math.min(start.x, point.x), top = Math.min(start.y, point.y);
      box.style.left = `${left}px`; box.style.top = `${top}px`;
      box.style.width = `${Math.abs(point.x - start.x)}px`; box.style.height = `${Math.abs(point.y - start.y)}px`;
    };
    const finish = event => {
      document.removeEventListener('pointermove', update);
      document.removeEventListener('pointerup', finish);
      const point = this._canvasPoint(event);
      const left = Math.min(start.x, point.x), right = Math.max(start.x, point.x);
      const top = Math.min(start.y, point.y), bottom = Math.max(start.y, point.y);
      const data = this._ctxData();
      const hitIds = new Set(Object.values(data?.nodes || {}).filter(node => {
        const el = document.getElementById(`de-node-${node.id}`);
        const x = node.x ?? 60, y = node.y ?? 60, w = el?.offsetWidth || 200, h = el?.offsetHeight || 120;
        return x < right && x + w > left && y < bottom && y + h > top;
      }).map(node => node.id));
      this.selectedNodeIds = additive
        ? new Set([...this.selectedNodeIds].filter(id => !hitIds.has(id)).concat([...hitIds].filter(id => !this.selectedNodeIds.has(id))))
        : hitIds;
      this.selectedNodeId = this.selectedNodeIds.size === 1 ? [...this.selectedNodeIds][0] : null;
      box.remove(); this._boxSelect = null;
      this._suppressCanvasClick = true;
      this._renderCanvas();
      if (this.selectedNodeId) this._loadNodeEditor();
    };
    document.addEventListener('pointermove', update);
    document.addEventListener('pointerup', finish, { once: true });
  }

  _copySelectedNodes() {
    const data = this._ctxData();
    const ids = [...this.selectedNodeIds];
    if (!data || !ids.length) { this._st('请先框选要复制的节点'); return; }
    const idSet = new Set(ids);
    const nodes = ids.map(id => this._cloneBlueprintValue(data.nodes[id])).filter(Boolean);
    const connections = (data.connections || []).filter(connection => idSet.has(connection.fromNodeId) && idSet.has(connection.toNodeId)).map(connection => ({ ...connection }));
    this._blueprintClipboard = { nodes, connections };
    this._st(`已复制 ${nodes.length} 个节点及 ${connections.length} 条内部连线`);
  }

  _pasteSelectedNodes() {
    const data = this._ctxData(), clip = this._blueprintClipboard;
    if (!data || !clip?.nodes?.length) { this._st('剪贴板中没有蓝图节点'); return; }
    const idMap = new Map();
    const reservedIds = new Set(Object.keys(data.nodes || {}));
    clip.nodes.forEach(node => {
      let newId;
      do { newId = this._uid('n'); } while (reservedIds.has(newId));
      reservedIds.add(newId);
      idMap.set(node.id, newId);
    });
    const pastedIds = [];
    clip.nodes.forEach(source => {
      const node = this._cloneBlueprintValue(source);
      node.id = idMap.get(source.id);
      node.x = (node.x ?? 60) + 40; node.y = (node.y ?? 60) + 40;
      if (idMap.has(node.next)) node.next = idMap.get(node.next);
      (node.options || []).forEach(option => { if (idMap.has(option.next)) option.next = idMap.get(option.next); });
      data.nodes[node.id] = node; pastedIds.push(node.id);
    });
    (clip.connections || []).forEach(connection => {
      data.connections ||= [];
      data.connections.push({ ...connection, fromNodeId: idMap.get(connection.fromNodeId), toNodeId: idMap.get(connection.toNodeId) });
    });
    this.selectedNodeIds = new Set(pastedIds); this.selectedNodeId = pastedIds.length === 1 ? pastedIds[0] : null;
    this._saveLS(); this._renderCanvas();
    if (this.selectedNodeId) this._loadNodeEditor();
    this._st(`已粘贴 ${pastedIds.length} 个节点，已生成全新 ID`);
  }

  _onCanvasClick(e) {
    if (this._suppressCanvasClick) { this._suppressCanvasClick = false; return; }
    const t=e.target;
    if (t.id==='de-canvas-container'||t.id==='de-canvas-nodes'||t.closest('svg')) {
      if (this._connectMode) { this._cancelConnect(); return; }
      this.selectedNodeId=null;
      this.selectedNodeIds.clear();
      const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
      if(ef) ef.style.display=''; if(ff) ff.style.display='none';
      this._renderCanvas();
    }
  }

  // ── node editor ──────────────────────────────────────────────────────────
  _loadNodeEditor() {
    const data = this._ctxData(); if (!data || !this.selectedNodeId) return;
    const node = data.nodes[this.selectedNodeId]; if (!node) return;
    const empty = this._el('de-editor-empty'), form = this._el('de-editor-form');
    if (empty) empty.style.display = 'none';
    if (form) form.style.display = '';
    const typeLabel = this._el('de-ed-type-label');
    if (typeLabel) typeLabel.textContent = `${_DE_NODE_LABELS[node.type] || node.type || '节点'}（${node.type || 'unknown'}）`;
    this._renderNodeInputs(node, data);
    this._renderFlowOutputs(node, data);
  }

  _valueOutputRefs(data) {
    return Object.values(data.nodes || {}).flatMap(node => this._portsFor(node, 'output').filter(port => port.kind === 'value').map(port => ({ nodeId: node.id, port: port.name, label: `${node.id}.${port.name}` })));
  }

  _constantChoices(port) {
    const choices = {
      speaker: _DE_SPEAKERS.map(item => [item.id, item.label]),
      operator: [
        ['+','加'], ['-','减'], ['*','乘'], ['/','除'], ['%','余'],
        ['and','与'], ['or','或'], ['xor','异或'],
        ['>','大于'], ['<','小于'], ['=','等于'], ['not','非'],
      ],
      condition: [['false', '否'], ['true', '是']],
      statId: [..._DE_NUMVARS.map(id => [id, id]), ...skillManager.all().map(item => [item.id, `${item.label} (${item.id})`])],
      queue: [['work','Work'],['social','Social']],
      variableId: (globalVariableManager.definitions || []).map(item => [String(item.id), `${item.name} (${item.id})`]),
      itemId: (itemManager.defs ? Array.from(itemManager.defs.values()) : this.gameItems).map(item => [item.id, item.name || item.id]),
      scheduleId: Array.from(scheduleData.scheduleById?.keys?.() || []).map(id => [id, id]),
      instanceId: Array.from(scheduleData.scheduleById?.keys?.() || []).map(id => [id, id]),
    }[port.name];
    return choices?.length ? choices : null;
  }

  _constantControl(port, value) {
    const choices = this._constantChoices(port);
    if (choices) return `<select class="dev-de-input-value" onchange="_de._saveInputValue('${this._e(port.name)}',this.value)"><option value="">选择常量</option>${choices.map(([id,label]) => `<option value="${this._e(id)}"${String(value)===String(id)?' selected':''}>${this._e(label)}</option>`).join('')}</select>`;
    if (port.name === 'text') return `<textarea class="dev-de-input-value dev-de-input-text" oninput="_de._saveInputValue('${this._e(port.name)}',this.value)">${this._e(value ?? '')}</textarea>`;
    return `<input class="dev-de-input-value" type="${port.type==='number'?'number':'text'}" value="${this._e(value ?? '')}" oninput="_de._saveInputValue('${this._e(port.name)}',this.value)">`;
  }

  _renderFlowOutputs(node, data) {
    const el=this._el('de-flow-outputs'); if(!el) return;
    const outputs=this._portsFor(node,'output').filter(port=>port.kind==='flow');
    const targets=Object.values(data.nodes||{}).flatMap(target=>this._portsFor(target,'input').filter(port=>port.kind==='flow').map(port=>({nodeId:target.id,port:port.name,label:`${target.id}.${port.name}`})));
    el.innerHTML=outputs.length ? outputs.map(output=>{
      const connection=(data.connections||[]).find(item=>item.fromNodeId===node.id && item.fromPort===output.name);
      const current=connection ? `${connection.toNodeId}::${connection.toPort}` : '';
      return `<div class="dev-de-output-row"><label>${this._e(output.name)}</label><select onchange="_de._saveFlowTarget('${this._e(output.name)}',this.value)"><option value="">（结束）</option>${targets.filter(item=>item.nodeId!==node.id).map(item=>`<option value="${this._e(`${item.nodeId}::${item.port}`)}"${current===`${item.nodeId}::${item.port}`?' selected':''}>${this._e(item.label)}</option>`).join('')}</select></div>`;
    }).join('') : '<div class="dev-de-no-ports">此节点没有流程输出</div>';
  }

  _saveFlowTarget(fromPort, value) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    if(!data || !node) return;
    data.connections=(data.connections||[]).filter(item=>!(item.fromNodeId===node.id && item.fromPort===fromPort));
    if(value) {
      const [toNodeId,toPort]=value.split('::');
      const source=getScheduleNodePort(node.type,fromPort,'output',node);
      const target=getScheduleNodePort(data.nodes[toNodeId]?.type,toPort,'input',data.nodes[toNodeId]);
      if(!source || !target || source.kind!=='flow' || target.kind!=='flow') { this._st('流程输出只能连接流程输入'); this._renderFlowOutputs(node,data); return; }
      data.connections.push({fromNodeId:node.id,fromPort,toNodeId,toPort});
    }
    this._saveLS(); this._renderCanvas(); this._renderFlowOutputs(node,data);
  }

  _renderNodeInputs(node, data) {
    const el=this._el('de-ed-inputs'); if(!el) return;
    const def=getScheduleNodeDefinition(node.type || 'text') || {};
    const refs=this._valueOutputRefs(data);
    const connections=data.connections || [];
    const valueInputs = [...(def.valueInputs || [])];
    if (node.type === 'choice') {
      const count = Math.max(0, Math.min(32, Number.isInteger(Number(node.inputs?.branchCount)) ? Number(node.inputs.branchCount) : (node.options || []).length));
      for (let index = 0; index < count; index += 1) valueInputs.push({ name: `label${index}`, kind: 'value', type: 'string' });
    }
    if (node.type === 'segmentBranch') {
      const count = Math.max(1, Math.min(32, Number.isInteger(Number(node.inputs?.branchCount)) ? Number(node.inputs.branchCount) : 1));
      for (let index = 1; index <= count; index += 1) valueInputs.push({ name: `boundary${index}`, kind: 'value', type: 'number' });
    }
    const html=valueInputs.map(port => {
      const connection=connections.find(item=>item.toNodeId===node.id && item.toPort===port.name);
      const modeKey=`${node.id}:${port.name}`;
      const pinMode=this._inputModes.get(modeKey) ?? Boolean(connection);
      const raw=node.inputs?.[port.name];
      const labelIndex = /^label(\d+)$/.exec(port.name)?.[1];
      const value=raw && typeof raw==='object' && raw.nodeId ? '' : (raw ?? (port.name === 'branchCount' ? (node.options || []).length : (labelIndex != null ? node.options?.[Number(labelIndex)]?.label : '')) ?? '');
      const refOptions=refs.filter(ref=>ref.nodeId!==node.id).map(ref=>{
        const source=getScheduleNodePort(data.nodes[ref.nodeId]?.type,ref.port,'output',data.nodes[ref.nodeId]);
        return source && (port.type==='any' || source.type==='any' || source.type===port.type) ? `<option value="${this._e(`${ref.nodeId}::${ref.port}`)}" ${connection && connection.fromNodeId===ref.nodeId && connection.fromPort===ref.port ? 'selected' : ''}>${this._e(ref.label)}</option>` : '';
      }).join('');
      return `<div class="dev-de-input-row"><label>${this._e(port.name)}</label><select class="dev-de-input-mode" onchange="_de._setInputMode('${this._e(port.name)}',this.value)"><option value="constant" ${pinMode?'':'selected'}>固定值</option><option value="pin" ${pinMode?'selected':''}>来自上游数值引脚</option></select>${pinMode ? `<select class="dev-de-input-source" onchange="_de._setInputSource('${this._e(port.name)}',this.value)"><option value="">选择上游输出</option>${refOptions}</select>` : this._constantControl(port,value)}</div>`;
    }).join('');
    el.innerHTML=html || '<div class="dev-de-no-ports">此节点没有输入</div>';
    this._renderFlowOutputs(node,data);
  }

  _saveInputValue(name,value) {
    const data=this._ctxData(); const node=data?.nodes?.[this.selectedNodeId];
    const port=node && getScheduleNodePort(node.type,name,'input',node);
    if(!node || !port || port.kind!=='value') return;
    const parsedValue = port.type === 'number' && value !== '' ? Number(value) : port.type === 'bool' ? value === 'true' : value;
    node.inputs={...(node.inputs||{}),[name]:parsedValue};
    if (node.type === 'choice' && name === 'branchCount') this._syncChoiceOptions(node);
    if (node.type === 'segmentBranch' && name === 'branchCount') this._syncSegmentPorts(node);
    if (node.type === 'choice') {
      const labelIndex = /^label(\d+)$/.exec(name)?.[1];
      if (labelIndex != null) {
        node.options ||= [];
        node.options[Number(labelIndex)] ||= this._emptyOpt();
        node.options[Number(labelIndex)].label = value;
      }
    }
    this._saveLS(); this._renderCanvas(); this._loadNodeEditor();
  }

  _syncChoiceOptions(node) {
    const count = Math.max(0, Math.min(32, Number(node.inputs?.branchCount) || 0));
    node.options ||= [];
    while (node.options.length < count) node.options.push(this._emptyOpt());
    if (node.options.length > count) node.options.length = count;
    Object.keys(node.inputs || {}).filter(name => /^label\d+$/.test(name) && Number(name.slice(5)) >= count).forEach(name => delete node.inputs[name]);
    const data = this._ctxData();
    if (data) data.connections = (data.connections || []).filter((connection) => {
      const removedOutput = connection.fromNodeId === node.id && connection.fromPort?.startsWith('option') && Number(connection.fromPort.slice(6)) >= count;
      const removedInput = connection.toNodeId === node.id && connection.toPort?.startsWith('label') && Number(connection.toPort.slice(5)) >= count;
      return !removedOutput && !removedInput;
    });
  }

  _syncSegmentPorts(node) {
    const count = Math.max(1, Math.min(32, Math.floor(Number(node.inputs?.branchCount) || 1)));
    node.inputs ||= {};
    for (let index = 0; index <= count; index += 1) if (!Object.prototype.hasOwnProperty.call(node.inputs, `boundary${index}`)) node.inputs[`boundary${index}`] = 0;
    Object.keys(node.inputs).filter(name => /^boundary\d+$/.test(name) && Number(name.slice(8)) > count).forEach(name => delete node.inputs[name]);
    const data = this._ctxData();
    if (data) data.connections = (data.connections || []).filter((connection) => {
      const removedOutput = connection.fromNodeId === node.id && connection.fromPort?.startsWith('segment') && Number(connection.fromPort.slice(7)) >= count;
      const removedInput = connection.toNodeId === node.id && connection.toPort?.startsWith('boundary') && Number(connection.toPort.slice(8)) > count;
      return !removedOutput && !removedInput;
    });
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
    const source=getScheduleNodePort(data.nodes[fromNodeId]?.type, fromPort, 'output', data.nodes[fromNodeId]);
    const target=getScheduleNodePort(node.type, name, 'input', node);
    if(!source || !target || source.kind!=='value' || target.kind!=='value') { this._st('只能连接数值输出到数值输入'); return; }
    data.connections=(data.connections||[]).filter(item=>!(item.toNodeId===node.id && item.toPort===name));
    data.connections.push({fromNodeId,fromPort,toNodeId:node.id,toPort:name});
    this._saveLS(); this._renderNodeInputs(node,data); this._renderCanvas();
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
    const source=getScheduleNodePort(data.nodes[from.nodeId]?.type, from.port, 'output', data.nodes[from.nodeId]);
    const target=getScheduleNodePort(data.nodes[targetNodeId]?.type, targetPort, 'input', data.nodes[targetNodeId]);
    if(from.nodeId===targetNodeId || !source || !target || source.kind!==target.kind || (source.kind==='value' && target.type!=='any' && source.type!=='any' && source.type!==target.type) || targetKind!==target.kind) {
      this._st('引脚类型不匹配：流程只能连接流程，数值只能连接数值'); this._cancelConnect(); return;
    }
    data.connections=(data.connections||[]).filter(item=>!(item.fromNodeId===from.nodeId && item.fromPort===from.port));
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
        const source=getScheduleNodePort(node.type,fromPort,'output',node);
        const target=getScheduleNodePort(data.nodes[targetId]?.type,'flowIn','input',data.nodes[targetId]);
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
  addNode(type) {
    const data = this._ctxData(); if (!data) { this._st('请先从左侧选择天数或事件'); return; }
    const nodeType = type || this._el('de-new-node-type-1')?.value || 'text';
    if (!nodeType || !getScheduleNodeDefinition(nodeType)) { this._st('已取消或节点种类无效'); return; }
    const node = this._emptyNode(80 + Object.keys(data.nodes).length * 20, 80 + Object.keys(data.nodes).length * 20);
    node.type=nodeType;
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

  _deleteSelectedNodes() {
    const data = this._ctxData();
    const ids = new Set(this.selectedNodeIds.size ? this.selectedNodeIds : (this.selectedNodeId ? [this.selectedNodeId] : []));
    if (!data || !ids.size) return;
    if (!confirm(`确认删除选中的 ${ids.size} 个节点？`)) return;
    ids.forEach(id => delete data.nodes[id]);
    data.connections = (data.connections || []).filter(connection => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId));
    Object.values(data.nodes).forEach(n => {
      if (ids.has(n.next)) n.next = null;
      (n.options||[]).forEach(o => { if (ids.has(o.next)) o.next = null; });
    });
    if (ids.has(data.startNodeId)) data.startNodeId = Object.values(data.nodes).find(node => node.type === 'flowStart')?.id || null;
    this.selectedNodeId = null; this.selectedNodeIds.clear();
    const ef = this._el('de-editor-empty'), ff = this._el('de-editor-form');
    if (ef) ef.style.display = ''; if (ff) ff.style.display = 'none';
    this._saveLS(); this._renderCanvas();
  }

  _deleteSelectedNode() { this._deleteSelectedNodes(); }


  // ── auto layout ───────────────────────────────────────────────────────────
  _autoLayout() {
    const data = this._ctxData(); if (!data) return;
    const nodes = data.nodes; const ids = Object.keys(nodes);
    if (!ids.length) return;
    const W = 200, H = 120, GAPX = 100, GAPY = 45, PAD = 40;
    const orderIndex = new Map(ids.map((id, index) => [id, index]));
    const outgoing = new Map(ids.map(id => [id, new Set()]));
    const incoming = new Map(ids.map(id => [id, new Set()]));
    const addEdge = (from, to) => {
      if (!nodes[from] || !nodes[to] || from === to) return;
      outgoing.get(from).add(to); incoming.get(to).add(from);
    };
    // Object blueprints store the authoritative graph in typed connections.
    (data.connections || []).forEach(connection => addEdge(connection.fromNodeId, connection.toNodeId));
    // Keep compatibility with legacy tree-shaped entries while laying them out.
    ids.forEach(id => {
      const node = nodes[id];
      addEdge(id, node.next);
      (node.options || []).forEach(option => addEdge(id, option.next));
    });
    const indegree = new Map(ids.map(id => [id, incoming.get(id).size]));
    const ranks = new Map(ids.map(id => [id, 0]));
    const queue = ids.filter(id => indegree.get(id) === 0);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor];
      outgoing.get(id).forEach(target => {
        ranks.set(target, Math.max(ranks.get(target), ranks.get(id) + 1));
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      });
    }
    // Cycles are invalid for normal flow graphs, but still receive stable ranks.
    const maxRank = Math.max(0, ...ranks.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    ids.forEach(id => layers[ranks.get(id)].push(id));
    const position = () => new Map(layers.flatMap(layer => layer.map((id, index) => [id, index])));
    const reorder = (layerIndex, useParents) => {
      const current = layers[layerIndex];
      const positions = position();
      current.sort((left, right) => {
        const neighbors = id => [...(useParents ? incoming.get(id) : outgoing.get(id))]
          .filter(neighbor => ranks.get(neighbor) === (useParents ? layerIndex - 1 : layerIndex + 1))
          .map(neighbor => positions.get(neighbor))
          .sort((a, b) => a - b);
        const median = values => values.length ? values[Math.floor((values.length - 1) / 2)] : Number.POSITIVE_INFINITY;
        return median(neighbors(left)) - median(neighbors(right)) || orderIndex.get(left) - orderIndex.get(right);
      });
    };
    // Barycenter sweeps keep fan-out and fan-in branches in their natural order,
    // reducing crossings without making layout depend on DOM measurements.
    for (let pass = 0; pass < 4; pass += 1) {
      for (let layer = 1; layer < layers.length; layer += 1) reorder(layer, true);
      for (let layer = layers.length - 2; layer >= 0; layer -= 1) reorder(layer, false);
    }
    layers.forEach((layer, rank) => layer.forEach((id, row) => {
      nodes[id].x = PAD + rank * (W + GAPX);
      nodes[id].y = PAD + row * (H + GAPY);
    }));
    const widestLayer = Math.max(1, ...layers.map(layer => layer.length));
    const needW = PAD + layers.length * (W + GAPX) + PAD;
    const needH = PAD + widestLayer * (H + GAPY) + PAD;
    const nodesDiv = this._el('de-canvas-nodes');
    const svgEl    = this._el('de-canvas-svg');
    if (nodesDiv) { nodesDiv.style.minWidth  = Math.max(2000, needW) + 'px';
                    nodesDiv.style.minHeight = Math.max(1200, needH) + 'px'; }
    if (svgEl)    { svgEl.setAttribute('width',  Math.max(2000, needW));
                    svgEl.setAttribute('height', Math.max(1200, needH)); }
    this._saveLS(); this._renderCanvas();
    // Scroll back to origin so newly placed nodes are immediately visible
    const wrap = this._el('de-canvas-container');
    if (wrap) { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
  }

  // ── event / ending ───────────────────────────────────────────────────────
  _addEvent() {
    const id = prompt('事件 ID（英文/数字，唯一）:', 'event_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.events[id]) { alert('ID 已存在'); return; }
    this.project.events[id] = this._emptyCtx();
    this.loadedMetaFiles.add('special_events.json');
    this._renderScopedSidebar(); this._saveLS(); this._selectCtx('event', id);
  }

  _addEnding() {
    const id = prompt('结局 ID（英文/数字，唯一）:', 'ending_'+Date.now().toString(36).slice(-5));
    if (!id?.trim()) return;
    if (this.project.endings[id]) { alert('ID 已存在'); return; }
    this.project.endings[id] = this._emptyCtx();
    this.loadedMetaFiles.add('endings.json');
    this._renderScopedSidebar(); this._saveLS(); this._selectCtx('ending', id);
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
    this._saveLS();
    if (this._workspace) this._renderWorkspace();
    else { this._renderScopedSidebar(); this._renderCanvas(); }
    const ef=this._el('de-editor-empty'),ff=this._el('de-editor-form');
    if(ef) ef.style.display=''; if(ff) ff.style.display='none';
    this._st('已新建项目');
  }

  async _saveProject() {
    const errors=this._validateTypedBlueprints();
    if(errors.length){ alert(`蓝图校验失败：\n${errors.slice(0,8).join('\n')}`); return; }
    if (this._temporaryScope?.onSave) {
      await this._temporaryScope.onSave(this._ctxData());
      this._st('临时日程已创建并插入队列');
      return;
    }
    this._saveLS();
    if (this._embeddedScope?.onSave) this._embeddedScope.onSave(this._ctxData());
    this._st(this._embeddedScope ? '内嵌日程已保存到宿主编辑器内存' : '已保存到浏览器');
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
        this._saveLS();
        if (this._workspace) this._renderWorkspace();
        else { this._renderScopedSidebar(); this._renderCanvas(); }
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
      this._saveLS();
      if (this._workspace) this._renderWorkspace();
      else { this._renderScopedSidebar(); this._renderCanvas(); }
      if (this._workspace && this.currentCtx) this._selectCtx(this.currentCtx.type, this.currentCtx.id, this.currentCtx.entryIndex || 0);
      this._st(`已从当前游戏读取 ${files.length} 个日程文件`);
    } catch (err) { this._st(`读取当前游戏失败：${err.message}`, true); }
  }

  _onGameFiles(ev) {
    const files = Array.from(ev.target.files); if (!files.length) return;
    let count = 0;
    const done = () => {
      count++;
      if (count === files.length) { this._saveLS(); this._renderScopedSidebar(); this._st(`已导入 ${files.length} 个游戏文件`); }
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
    return { ...schedule, entries: (schedule?.entries || []).map((entry) => {
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
      delete node.speaker; delete node.text; delete node.keywordIds; delete node.entryConds;
      delete node.options; delete node.branches; delete node.onShow; delete node.conditions;
      delete node.condition; delete node.globalVariableCondition; delete node.next;
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

