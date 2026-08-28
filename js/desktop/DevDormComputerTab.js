// DEV-TOOLS:START
import { dataLoader, writeJSONToDisk } from "../core/DataLoader.js";

/**
 * DevDormComputerTab — edit social_apps.json content:
 *   - 吱乎 / 小绿书 posts (title, author, content, likes, tags, answers)
 *   - 企鹅群 group messages
 *   - chatgtpDaily entries (day, Q&A pairs in order)
 *
 * Pattern: same "sidebar list + form" layout as DevItemEditorTab.
 * window._dct holds the current instance (for inline onclick= handlers).
 */
export class DevDormComputerTab {
  constructor(devMode) {
    this._dev = devMode;
    this._data = null;   // full social_apps.json object
    this._tab = "zhihu"; // active sub-tab: zhihu | xiaolvshu | qqgroup | chatgtp
    this._dirty = false;
  }

  _el(id) { return document.getElementById(id); }
  _e(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  _st(s) { this._dev.setStatus(s); }

  mount() {
    window._dct = this;
    this._loadData();
  }
  unmount() { window._dct = null; }

  html() {
    return `<div class="dev-dct-root">
<div class="dev-ie-toolbar">
  <strong style="font-size:13px">🖥️ 宿舍电脑内容编辑器</strong>
  <button type="button" class="win95-btn dev-btn" onclick="_dct._loadData()">⬇ 重新读取</button>
  <button type="button" class="win95-btn dev-btn" onclick="_dct.exportJSON()">📤 导出 JSON</button>
  <button type="button" class="win95-btn dev-btn" onclick="_dct.writeToDisk()">💽 写入磁盘</button>
  <span id="dct-msg" style="font-size:12px;color:#388e3c;margin-left:8px"></span>
</div>
<div style="display:flex;gap:0;flex:1;min-height:0;overflow:hidden">
  <div class="dev-ie-sidebar" style="width:130px;flex:0 0 130px">
    <div class="dev-ie-sidebar-hd" style="flex-direction:column;gap:2px">
      <button type="button" class="win95-btn dev-btn" style="width:100%;font-size:11px" onclick="_dct._setTab('zhihu')">🦉 吱乎</button>
      <button type="button" class="win95-btn dev-btn" style="width:100%;font-size:11px" onclick="_dct._setTab('xiaolvshu')">📗 小绿书</button>
      <button type="button" class="win95-btn dev-btn" style="width:100%;font-size:11px" onclick="_dct._setTab('qqgroup')">🐧 企鹅群</button>
      <button type="button" class="win95-btn dev-btn" style="width:100%;font-size:11px" onclick="_dct._setTab('chatgtp')">🤖 ChatGTP 每日</button>
    </div>
  </div>
  <div id="dct-panel" class="dev-ie-editor" style="padding:10px;overflow:auto">
    <p style="color:#aaa;font-size:12px">加载中…</p>
  </div>
</div>
</div>`;
  }

  async _loadData() {
    try {
      this._data = JSON.parse(JSON.stringify(await dataLoader.loadJSON("social_apps.json")));
      this._dirty = false;
      this._renderTab();
      this._st(`social_apps.json 已读取`);
    } catch (err) {
      this._st(`读取失败：${err.message}`);
    }
  }

  _setTab(tab) {
    this._tab = tab;
    this._renderTab();
  }

  _setDirty() { this._dirty = true; }

  // ── Router ───────────────────────────────────────────────────────────────────
  _renderTab() {
    const panel = this._el("dct-panel");
    if (!panel || !this._data) return;
    if (this._tab === "chatgtp") { panel.innerHTML = this._htmlChatGTPDaily(); return; }
    const app = (this._data.apps || []).find((a) => a.id === this._tab);
    if (!app) { panel.innerHTML = `<p style="color:#aaa">未找到应用数据</p>`; return; }
    if (this._tab === "qqgroup") panel.innerHTML = this._htmlQQGroup(app);
    else panel.innerHTML = this._htmlPosts(app);
  }

  // ── Posts (吱乎 / 小绿书) ─────────────────────────────────────────────────
  _htmlPosts(app) {
    const posts = app.posts || [];
    return `<div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
  <strong>${app.icon} ${app.name} 帖子</strong>
  <span style="font-size:11px;color:#888">（每天显示第 (当前天数 - 1) % 帖子总数 条）</span>
  <button type="button" class="win95-btn dev-btn" onclick="_dct._addPost('${app.id}')">＋ 添加帖子</button>
</div>
${posts.map((post, i) => this._htmlPostForm(app.id, post, i)).join("<hr style='margin:10px 0;border-color:#ccc'>")}
${posts.length === 0 ? '<p style="color:#aaa;font-size:12px">暂无帖子</p>' : ""}
</div>`;
  }

  _htmlPostForm(appId, post, i) {
    const answersStr = (post.answers || []).join("\n");
    const tagsStr    = (post.tags || []).join(", ");
    return `<div style="font-size:12px;padding:6px 0">
  <div class="dev-ie-row">
    <div class="dev-ie-field"><label>标题</label>
      <input type="text" value="${this._e(post.title)}" style="width:280px;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setPostField('${appId}',${i},'title',this.value)"></div>
    <div class="dev-ie-field"><label>作者</label>
      <input type="text" value="${this._e(post.author || "")}" style="width:120px;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setPostField('${appId}',${i},'author',this.value)"></div>
    <div class="dev-ie-field" style="flex:0"><label>👍</label>
      <input type="number" value="${post.likes ?? ""}" style="width:60px;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setPostField('${appId}',${i},'likes',this.value===''?null:Number(this.value))"></div>
  </div>
  <div class="dev-ie-field" style="margin-top:4px"><label>正文</label>
    <textarea rows="3" style="width:100%;border:2px inset #eee;padding:3px;font-size:12px;resize:vertical"
      onchange="_dct._setPostField('${appId}',${i},'content',this.value)">${this._e(post.content || "")}</textarea></div>
  <div class="dev-ie-row" style="margin-top:4px">
    ${appId === "zhihu" ? `<div class="dev-ie-field" style="flex:1"><label>回答（每行一条）</label>
      <textarea rows="3" style="width:100%;border:2px inset #eee;padding:3px;font-size:12px;resize:vertical"
        onchange="_dct._setPostAnswers('${appId}',${i},this.value)">${this._e(answersStr)}</textarea></div>` : ""}
    ${appId === "xiaolvshu" ? `<div class="dev-ie-field" style="flex:1"><label>标签（逗号分隔）</label>
      <input type="text" value="${this._e(tagsStr)}" style="width:100%;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setPostTags('${appId}',${i},this.value)"></div>` : ""}
  </div>
  <button type="button" class="win95-btn dev-btn" style="margin-top:4px;font-size:11px" onclick="_dct._removePost('${appId}',${i})">🗑 删除此帖</button>
</div>`;
  }

  _addPost(appId) {
    const app = (this._data.apps || []).find((a) => a.id === appId);
    if (!app) return;
    if (!app.posts) app.posts = [];
    app.posts.push({ id: `post_${Date.now()}`, title: "新帖子", author: "匿名", content: "", likes: 0 });
    this._dirty = true;
    this._renderTab();
  }

  _removePost(appId, i) {
    const app = (this._data.apps || []).find((a) => a.id === appId);
    if (!app?.posts) return;
    app.posts.splice(i, 1);
    this._dirty = true;
    this._renderTab();
  }

  _setPostField(appId, i, field, value) {
    const app = (this._data.apps || []).find((a) => a.id === appId);
    if (!app?.posts?.[i]) return;
    app.posts[i][field] = value;
    this._dirty = true;
  }

  _setPostAnswers(appId, i, raw) {
    const app = (this._data.apps || []).find((a) => a.id === appId);
    if (!app?.posts?.[i]) return;
    app.posts[i].answers = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    this._dirty = true;
  }

  _setPostTags(appId, i, raw) {
    const app = (this._data.apps || []).find((a) => a.id === appId);
    if (!app?.posts?.[i]) return;
    app.posts[i].tags = raw.split(",").map((s) => s.trim()).filter(Boolean);
    this._dirty = true;
  }

  // ── QQ Group ─────────────────────────────────────────────────────────────────
  _htmlQQGroup(app) {
    const groups = app.groups || [];
    return `<div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
  <strong>🐧 企鹅群</strong>
  <button type="button" class="win95-btn dev-btn" onclick="_dct._addGroup()">＋ 添加群</button>
</div>
${groups.map((g, gi) => `<div style="border:2px inset #ddd;padding:8px;margin-bottom:10px;font-size:12px">
  <div class="dev-ie-row">
    <div class="dev-ie-field"><label>群名</label>
      <input type="text" value="${this._e(g.name)}" style="width:180px;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setGroupField(${gi},'name',this.value)"></div>
    <button type="button" class="win95-btn dev-btn" style="margin-left:auto;align-self:flex-end" onclick="_dct._removeGroup(${gi})">🗑 删除群</button>
  </div>
  <table class="dev-table" style="font-size:11px;width:100%;margin-top:6px">
    <thead><tr><th>发送者</th><th style="width:60%">消息</th><th>删除</th></tr></thead>
    <tbody>${(g.messages || []).map((msg, mi) => `<tr>
      <td><input type="text" value="${this._e(msg.sender)}" style="width:80px;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_dct._setMsgField(${gi},${mi},'sender',this.value)"></td>
      <td><input type="text" value="${this._e(msg.text)}" style="width:100%;min-height:18px;border:2px inset #eee;padding:1px 3px;font-size:11px"
        onchange="_dct._setMsgField(${gi},${mi},'text',this.value)"></td>
      <td><button type="button" class="win95-btn dev-btn" onclick="_dct._removeMsg(${gi},${mi})">✕</button></td>
    </tr>`).join("")}</tbody>
  </table>
  <button type="button" class="win95-btn dev-btn" style="margin-top:4px;font-size:11px" onclick="_dct._addMsg(${gi})">＋ 添加消息</button>
</div>`).join("")}
</div>`;
  }

  _addGroup() {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app) return;
    if (!app.groups) app.groups = [];
    app.groups.push({ id: "grp_" + Math.random().toString(36).slice(2, 6), name: "新群", messages: [] });
    this._dirty = true;
    this._renderTab();
  }

  _removeGroup(gi) {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app?.groups) return;
    app.groups.splice(gi, 1);
    this._dirty = true;
    this._renderTab();
  }

  _setGroupField(gi, field, val) {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app?.groups?.[gi]) return;
    app.groups[gi][field] = val;
    this._dirty = true;
  }

  _addMsg(gi) {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app?.groups?.[gi]) return;
    if (!app.groups[gi].messages) app.groups[gi].messages = [];
    app.groups[gi].messages.push({ sender: "发送者", text: "消息内容" });
    this._dirty = true;
    this._renderTab();
  }

  _removeMsg(gi, mi) {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app?.groups?.[gi]?.messages) return;
    app.groups[gi].messages.splice(mi, 1);
    this._dirty = true;
    this._renderTab();
  }

  _setMsgField(gi, mi, field, val) {
    const app = (this._data.apps || []).find((a) => a.id === "qqgroup");
    if (!app?.groups?.[gi]?.messages?.[mi]) return;
    app.groups[gi].messages[mi][field] = val;
    this._dirty = true;
  }

  // ── ChatGTP Daily ─────────────────────────────────────────────────────────────
  _htmlChatGTPDaily() {
    const daily = this._data.chatgtpDaily || [];
    return `<div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
  <strong>🤖 ChatGTP 每日预设对话</strong>
  <span style="font-size:11px;color:#888">（按天数顺序排列，玩家每天可按顺序查看一条）</span>
  <button type="button" class="win95-btn dev-btn" onclick="_dct._addDailyEntry()">＋ 添加天数</button>
</div>
${daily.map((entry, ei) => `<div style="border:2px inset #ddd;padding:8px;margin-bottom:10px;font-size:12px">
  <div class="dev-ie-row">
    <div class="dev-ie-field" style="flex:0"><label>天数</label>
      <input type="number" min="1" value="${entry.day ?? ei + 1}" style="width:60px;min-height:20px;border:2px inset #eee;padding:1px 4px;font-size:12px"
        onchange="_dct._setDailyField(${ei},'day',Number(this.value))"></div>
    <button type="button" class="win95-btn dev-btn" style="margin-left:auto;align-self:flex-end" onclick="_dct._removeDailyEntry(${ei})">🗑 删除</button>
  </div>
  <p style="font-size:11px;color:#888;margin:4px 0 2px">问答对（顺序排列，玩家每天按顺序消费一条）：</p>
  ${(entry.pairs || []).map((pair, pi) => `<div style="border:1px solid #ddd;padding:4px 6px;margin:4px 0;background:#fafafa">
    <div class="dev-ie-field"><label style="font-size:11px">玩家问</label>
      <input type="text" value="${this._e(pair.q)}" style="width:100%;min-height:18px;border:2px inset #eee;padding:1px 4px;font-size:11px"
        onchange="_dct._setPairField(${ei},${pi},'q',this.value)"></div>
    <div class="dev-ie-field" style="margin-top:3px"><label style="font-size:11px">AI 答</label>
      <textarea rows="2" style="width:100%;border:2px inset #eee;padding:2px 4px;font-size:11px;resize:vertical"
        onchange="_dct._setPairField(${ei},${pi},'a',this.value)">${this._e(pair.a)}</textarea></div>
    <button type="button" class="win95-btn dev-btn" style="font-size:10px;margin-top:2px" onclick="_dct._removePair(${ei},${pi})">✕ 删除此对</button>
  </div>`).join("")}
  <button type="button" class="win95-btn dev-btn" style="font-size:11px;margin-top:4px" onclick="_dct._addPair(${ei})">＋ 添加问答对</button>
</div>`).join("")}
${daily.length === 0 ? '<p style="color:#aaa;font-size:12px">暂无预设对话</p>' : ""}
</div>`;
  }

  _addDailyEntry() {
    if (!this._data.chatgtpDaily) this._data.chatgtpDaily = [];
    const nextDay = (this._data.chatgtpDaily.at(-1)?.day ?? 0) + 1;
    this._data.chatgtpDaily.push({ day: nextDay, pairs: [] });
    this._dirty = true;
    this._renderTab();
  }

  _removeDailyEntry(ei) {
    if (!this._data.chatgtpDaily) return;
    this._data.chatgtpDaily.splice(ei, 1);
    this._dirty = true;
    this._renderTab();
  }

  _setDailyField(ei, field, val) {
    if (!this._data.chatgtpDaily?.[ei]) return;
    this._data.chatgtpDaily[ei][field] = val;
    this._dirty = true;
  }

  _addPair(ei) {
    if (!this._data.chatgtpDaily?.[ei]) return;
    if (!this._data.chatgtpDaily[ei].pairs) this._data.chatgtpDaily[ei].pairs = [];
    this._data.chatgtpDaily[ei].pairs.push({ q: "问题", a: "回答" });
    this._dirty = true;
    this._renderTab();
  }

  _removePair(ei, pi) {
    if (!this._data.chatgtpDaily?.[ei]?.pairs) return;
    this._data.chatgtpDaily[ei].pairs.splice(pi, 1);
    this._dirty = true;
    this._renderTab();
  }

  _setPairField(ei, pi, field, val) {
    if (!this._data.chatgtpDaily?.[ei]?.pairs?.[pi]) return;
    this._data.chatgtpDaily[ei].pairs[pi][field] = val;
    this._dirty = true;
  }

  // ── Export / write ────────────────────────────────────────────────────────────
  exportJSON() {
    const blob = new Blob([JSON.stringify(this._data, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "social_apps.json";
    a.click();
    URL.revokeObjectURL(a.href);
    this._st("social_apps.json 已下载");
  }

  async writeToDisk() {
    const ok = await this._dev.writeToDisk("social_apps.json", this._data);
    if (ok) {
      this._dirty = false;
      const msg = this._el("dct-msg");
      if (msg) { msg.textContent = "✓ 已写入磁盘"; setTimeout(() => { msg.textContent = ""; }, 2000); }
    }
  }
}
// DEV-TOOLS:END
