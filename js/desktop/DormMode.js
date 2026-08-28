import { eventBus } from "../core/EventBus.js";
import { dataLoader } from "../core/DataLoader.js";
import { gameState } from "../core/GameState.js";
import { timeService } from "../core/TimeService.js";
import { scheduleData } from "../core/ScheduleData.js";
import { keywordManager } from "../core/KeywordManager.js";
import { npcStateManager } from "../core/NpcStateManager.js";
import { itemManager } from "../core/ItemManager.js";
import { itemPlacementManager } from "../core/ItemPlacementManager.js";
import { saveManager } from "../core/SaveManager.js";
import { createScheduleRunner } from "../core/ScheduleRunner.js";
import { realtimeQueue } from "../core/ScheduleQueue.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { launchChatGTPApp } from "../apps/ChatGTPApp.js";
import { renderInspectResult } from "../core/InspectFormat.js";
import { locationSystem } from "../core/LocationSystem.js";

const roommateImage = (npcId) => ({
  ajie: "data/assets/char_ajie_01.png",
  awei: "data/assets/char_awei_01.png",
  binbin: "data/assets/char_binbin_01.png",
}[npcId] || "");

const dialogueKeywordIds = (tree) => {
  if (typeof keywordManager.idsFromDialogueTree === "function") return keywordManager.idsFromDialogueTree(tree);
  const ids = [];
  Object.values(tree?.nodes || {}).forEach((node) => String(node?.text || "").replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_, id) => { if (!ids.includes(id)) ids.push(id); return _; }));
  return ids;
};

/** Full-screen off-duty dorm: NPC interaction, desk/fridge items, bed, computer. */
export default class DormMode {
  constructor(root, { workShell, launchWorkApp }) {
    this.root = root;
    this.workShell = workShell;
    this.launchWorkApp = launchWorkApp;
    this.scenes = null;
    this.entry = null;
    this._transitioning = false;
    this._computerOpen = false;
    this._compTabInit = {};
    this._transitionTimer = null;
    this._build();
    eventBus.on("daynight:changed", (detail) => this._onStateChanged(detail));
    eventBus.on("time:changed", () => this._renderClock());
    eventBus.on("gamestate:changed", () => this._renderClock());
  }

  async init() {
    this.scenes = await dataLoader.loadJSON("monitor_scenes.json");
    await this._renderScene();
    this._syncVisibility(false);
  }

  // ── DOM construction ────────────────────────────────────────────────────────
  _build() {
    this.root.className = "dorm-mode-overlay hidden";
    this.root.innerHTML = `
      <div class="dorm-fs-root">
        <div class="dorm-fs-header">
          <strong class="dorm-fs-title">🏠 宿舍</strong>
          <div class="dorm-wall-clock">
            <span class="dorm-wall-clock-label">GAME TIME</span><strong></strong>
          </div>
          <div class="dorm-fs-actions">
            <button type="button" class="win95-btn bevel-out" data-action="bed">🛏️ 睡觉</button>
            <button type="button" class="win95-btn bevel-out" data-action="clue">🧵 线索墙</button>
            <button type="button" class="win95-btn bevel-out" data-action="computer">🖥️ 电脑</button>
          </div>
        </div>

        <div class="dorm-fs-scene">
          <div class="dorm-bunk-unit" data-npc="player">
            <div class="dorm-bunk-top" title="主角（点击查看状态）">
              <img class="dorm-bunk-char" src="data/assets/char01_01_stage.png" alt="主角" />
              <span class="dorm-bunk-bed-rail"></span>
            </div>
            <div class="dorm-bunk-bottom">
              <div class="dorm-bunk-desk" id="desk-player_desk"></div>
              <span class="dorm-bunk-label">主角</span>
            </div>
          </div>
          <div class="dorm-bunk-unit" data-npc="ajie">
            <div class="dorm-bunk-top" id="bed-ajie">
              <span class="dorm-bunk-bed-rail"></span>
            </div>
            <div class="dorm-bunk-bottom">
              <div class="dorm-bunk-desk" id="desk-ajie_desk"></div>
              <span class="dorm-bunk-label">阿杰</span>
            </div>
          </div>
          <div class="dorm-bunk-unit" data-npc="awei">
            <div class="dorm-bunk-top" id="bed-awei">
              <span class="dorm-bunk-bed-rail"></span>
            </div>
            <div class="dorm-bunk-bottom">
              <div class="dorm-bunk-desk" id="desk-awei_desk"></div>
              <span class="dorm-bunk-label">阿伟</span>
            </div>
          </div>
          <div class="dorm-bunk-unit" data-npc="binbin">
            <div class="dorm-bunk-top" id="bed-binbin">
              <span class="dorm-bunk-bed-rail"></span>
            </div>
            <div class="dorm-bunk-bottom">
              <div class="dorm-bunk-desk" id="desk-binbin_desk"></div>
              <span class="dorm-bunk-label">彬彬</span>
            </div>
          </div>
          <div class="dorm-fridge-col">
            <div class="dorm-fridge" id="desk-fridge">
              <div class="dorm-fridge-label">🧊 小冰柜</div>
            </div>
          </div>
        </div>

        <div class="dorm-interaction panel-inset">
          <p class="dorm-interaction-hint">点击铺位上的人物交互 · 点击主角查看状态与物品</p>
        </div>

        <div class="dorm-bed-confirm hidden" role="dialog" aria-modal="true">
          <div class="dorm-bed-confirm-box panel-inset">
            <strong class="dorm-bed-confirm-title"></strong>
            <p class="dorm-bed-confirm-message"></p>
            <div class="dorm-bed-confirm-actions">
              <button type="button" class="win95-btn bevel-out dorm-bed-confirm-ok">确认</button>
              <button type="button" class="win95-btn bevel-out dorm-bed-confirm-cancel">取消</button>
            </div>
          </div>
        </div>

        <div class="dorm-computer-overlay hidden">
          <div class="dorm-computer-inner">
            <div class="dorm-computer-tabs">
              <button type="button" class="win95-btn bevel-out dorm-comp-tab-btn active" data-comptab="chatgtp">🤖 ChatGTP</button>
              <button type="button" class="win95-btn bevel-out dorm-comp-tab-btn" data-comptab="social">📱 社交媒体</button>
              <button type="button" class="win95-btn bevel-out dorm-comp-close">✖ 关闭电脑</button>
            </div>
            <div class="dorm-computer-panel" data-comppanel="chatgtp"></div>
            <div class="dorm-computer-panel hidden" data-comppanel="social"></div>
          </div>
        </div>
      </div>`;

    this.clock          = this.root.querySelector(".dorm-wall-clock strong");
    this.interaction    = this.root.querySelector(".dorm-interaction");
    this.confirmPanel   = this.root.querySelector(".dorm-bed-confirm");
    this.confirmTitle   = this.root.querySelector(".dorm-bed-confirm-title");
    this.confirmMessage = this.root.querySelector(".dorm-bed-confirm-message");
    this.confirmPanel.querySelector(".dorm-bed-confirm-cancel").addEventListener("click", () => {
      this.confirmPanel.classList.add("hidden");
    });

    this.root.querySelector('[data-action="bed"]').addEventListener("click", () => this._bedAction());
    this.root.querySelector('[data-action="clue"]').addEventListener("click", () => this._showClueWall());
    this.root.querySelector('[data-action="computer"]').addEventListener("click", () => this._openComputer());

    this.root.querySelectorAll(".dorm-comp-tab-btn[data-comptab]").forEach((btn) => {
      btn.addEventListener("click", () => this._switchCompTab(btn.dataset.comptab));
    });
    this.root.querySelector(".dorm-comp-close").addEventListener("click", () => this._closeComputer());

    this.root.querySelector('[data-npc="player"] .dorm-bunk-top')
      .addEventListener("click", () => this._showPlayerMenu());
  }

  // ── Clock ───────────────────────────────────────────────────────────────────
  _clockMinutes() {
    const start = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    return gameState.clockMinutes;
  }

  _renderClock() {
    const minutes = this._clockMinutes();
    this.clock.textContent = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  // ── Scene render ────────────────────────────────────────────────────────────
  async _renderScene() {
    if (!this.scenes) return;
    this._renderClock();

    // ── NPC characters on their bunks ──────────────────────────────────────
    const listKey = gameState.phase === "day" ? "patients" : "contacts";
    this.entry = await scheduleData.load(gameState.day, gameState.phase);
    const actors = this.entry?.[listKey] || [];

    const npcMap = new Map();
    actors.forEach((actor) => {
      const npcId = actor.npcId || actor.id;
      if (["ajie", "awei", "binbin"].includes(npcId)) npcMap.set(npcId, actor);
    });

    const keywordDefs = {};
    npcMap.forEach((actor) =>
      Object.assign(keywordDefs, keywordManager.definitionsWithSource(
        dialogueKeywordIds(actor.dialogueTree), `宿舍-${actor.name}`))
    );

    ["ajie", "awei", "binbin"].forEach((npcId) => {
      const bedEl = this.root.querySelector(`#bed-${npcId}`);
      if (!bedEl) return;
      [...bedEl.querySelectorAll(".dorm-bunk-char, .dorm-npc-btn")].forEach((el) => el.remove());

      const actor = npcMap.get(npcId);
      const imgSrc = roommateImage(npcId);
      const offline = npcStateManager.isOffline(npcId);

      if (imgSrc) {
        const img = document.createElement("img");
        img.className = `dorm-bunk-char${offline ? " offline" : ""}`;
        img.src = imgSrc;
        img.alt = actor?.name || npcId;
        img.title = actor ? `${actor.name}${offline ? "（暂时离线）" : ""}` : npcId;
        img.setAttribute("role", "button");
        img.tabIndex = 0;
        if (actor) {
          const onClick = () => this._showDialogue(actor, keywordDefs);
          img.addEventListener("click", onClick);
          img.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
          });
        }
        bedEl.insertBefore(img, bedEl.querySelector(".dorm-bunk-bed-rail"));
      } else if (actor) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `win95-btn bevel-out dorm-npc-btn${offline ? " offline" : ""}`;
        btn.textContent = `${actor.avatar || "🙂"} ${actor.name}`;
        btn.addEventListener("click", () => this._showDialogue(actor, keywordDefs));
        bedEl.insertBefore(btn, bedEl.querySelector(".dorm-bunk-bed-rail"));
      }
    });

    // ── Items on desks / fridge ─────────────────────────────────────────────
    this._renderItemPlacements();
  }

  /**
   * Render items in each desk/fridge slot.
   * Sources (merged, deduplicated by itemId):
   *   1. ItemPlacementManager – condition-gated world placements (item_placements.json)
   *   2. ItemManager.worldItemsBySubLocation – items whose `locations` field
   *      contains "dorm/<subId>" (set via Item Editor)
   *
   * Sub-location id → DOM container mapping:
   *   player_desk  → #desk-player_desk
   *   ajie_desk    → #desk-ajie_desk
   *   awei_desk    → #desk-awei_desk
   *   binbin_desk  → #desk-binbin_desk
   *   fridge       → #desk-fridge
   */
  _renderItemPlacements() {
    // Clear previous item buttons (keep .dorm-fridge-label)
    this.root.querySelectorAll(".dorm-bunk-desk, .dorm-fridge").forEach((el) => {
      [...el.querySelectorAll(".dorm-item-slot-btn")].forEach((b) => b.remove());
    });

    const rendered = new Set(); // track itemId per sub-slot to avoid dupes

    // ── Source 1: ItemPlacementManager (condition-gated) ────────────────────
    itemPlacementManager.visibleFor("dorm").forEach((placement) => {
      const zone = placement.zone || "player_desk";
      const container = this.root.querySelector(`#desk-${zone}`);
      if (!container) return;

      const slotKey = `${zone}:${placement.itemId}`;
      rendered.add(slotKey);

      const hotspot = placement.hotspot || {};
      const btn = this._makeItemBtn(
        hotspot.icon || "❔",
        hotspot.label || itemManager.getDef(placement.itemId)?.name || placement.itemId,
        () => this._inspectPlacedItem(placement.id)
      );
      container.appendChild(btn);
    });

    // ── Source 2: items.json locations field ────────────────────────────────
    const bySubLoc = itemManager.worldItemsBySubLocation("dorm");
    bySubLoc.forEach((defs, subId) => {
      // subId "." means top-level "dorm" — show in interaction panel hint only
      if (subId === ".") return;

      const container = this.root.querySelector(`#desk-${subId}`);
      if (!container) return;

      defs.forEach((def) => {
        const slotKey = `${subId}:${def.id}`;
        if (rendered.has(slotKey)) return; // already shown via placement
        rendered.add(slotKey);

        // Determine layer: skip non-interactive (below) items
        if (def.layer === "below") return;

        const btn = this._makeItemBtn(
          def.icon || "📦",
          def.name || def.id,
          () => this._inspectWorldItem(def.id)
        );
        container.appendChild(btn);
      });
    });
  }

  _makeItemBtn(icon, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn bevel-out dorm-item-slot-btn";
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ── Item interaction ────────────────────────────────────────────────────────

  /** Inspect a world-placed item (item_placements.json, has take/put-back). */
  _inspectPlacedItem(placementId) {
    const inspected = itemPlacementManager.inspect(placementId);
    if (!inspected.ok) {
      this._message(inspected.message);
      return;
    }
    const def = itemManager.getDef(inspected.placement.itemId);
    this._showItemInteraction(def, inspected.result, {
      canTake: def?.pickable !== false,
      onTake: () => {
        const result = itemPlacementManager.take(placementId);
        this._message(result.message, result.ok ? "success" : "");
        if (result.ok) {
          this._renderScene();
          this._showHeldPlacement(placementId);
        }
      },
    });
  }

  /** Inspect a world item from items.json locations field (no placement record). */
  _inspectWorldItem(itemId) {
    const def = itemManager.getDef(itemId);
    if (!def) return;
    const result = itemManager.inspect(itemId);
    this._showItemInteraction(def, result, {
      canTake: def.pickable === true,
      onTake: def.pickable
        ? () => {
            itemManager.add(itemId, 1);
            this._message(`你拿起了${def.name}。`, "success");
            this._renderItemPlacements();
          }
        : null,
    });
  }

  /** Shared item interaction panel builder. */
  _showItemInteraction(def, result, { canTake, onTake } = {}) {
    this.interaction.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = def?.name || "物品";
    this.interaction.appendChild(heading);

    const resultEl = document.createElement("div");
    this.interaction.appendChild(resultEl);
    renderInspectResult(result, resultEl);

    // Appearance image (if any)
    const img = itemManager.getImage(def?.id);
    if (img) {
      const imgEl = document.createElement("img");
      imgEl.className = "item-image-preview";
      imgEl.src = img;
      imgEl.alt = def.name;
      this.interaction.appendChild(imgEl);
    }

    // Use button
    if (def?.usable) {
      const useBtn = document.createElement("button");
      useBtn.className = "win95-btn bevel-out";
      useBtn.textContent = "使用";
      useBtn.addEventListener("click", () => {
        const r = itemManager.use(def.id);
        this._message(r.message, r.ok ? "success" : "");
      });
      this.interaction.appendChild(useBtn);
    }

    // Take button
    if (canTake && onTake) {
      const takeBtn = document.createElement("button");
      takeBtn.className = "win95-btn bevel-out";
      takeBtn.textContent = "拿起并放入物品栏";
      takeBtn.addEventListener("click", onTake);
      this.interaction.appendChild(takeBtn);
    }
  }

  _showHeldPlacement(placementId) {
    const placement = itemPlacementManager.get(placementId);
    if (!placement) return;
    const putBackButton = document.createElement("button");
    putBackButton.className = "win95-btn bevel-out";
    putBackButton.textContent = "放回原处";
    putBackButton.addEventListener("click", () => {
      const result = itemPlacementManager.putBack(placementId);
      this._message(result.message, result.ok ? "success" : "");
      if (result.ok) this._renderScene();
    });
    this.interaction.appendChild(putBackButton);
  }

  // ── Computer overlay (ChatGTP + social media, inline) ───────────────────────
  _openComputer() {
    this._computerOpen = true;
    this.root.querySelector(".dorm-computer-overlay").classList.remove("hidden");
    // Load default tab content on first open
    this._switchCompTab("chatgtp");
  }

  _closeComputer() {
    this._computerOpen = false;
    this.root.querySelector(".dorm-computer-overlay").classList.add("hidden");
    // Also hide the legacy work-shell computer-screen (if ever activated)
    this.workShell.classList.remove("computer-screen-active");
    this.root.classList.remove("computer-open");
  }

  _switchCompTab(tabId) {
    // Update tab button states
    this.root.querySelectorAll(".dorm-comp-tab-btn[data-comptab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.comptab === tabId);
    });
    // Show / hide panels
    this.root.querySelectorAll(".dorm-computer-panel[data-comppanel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.comppanel !== tabId);
    });
    // Lazy-init panel content
    if (!this._compTabInit[tabId]) {
      this._compTabInit[tabId] = true;
      const panel = this.root.querySelector(`[data-comppanel="${tabId}"]`);
      if (tabId === "chatgtp") {
        launchChatGTPApp({ container: panel })
          .catch((err) => { panel.textContent = `ChatGTP 无法打开：${err.message}`; });
      } else if (tabId === "social") {
        this._renderSocialMedia(panel);
      }
    }
  }

  async _renderSocialMedia(panel) {
    panel.innerHTML = `<div class="sm-loading">加载中…</div>`;
    try {
      const data = await dataLoader.loadJSON("social_apps.json");
      panel.innerHTML = "";
      const apps = data.apps || [];
      const tabsBar = document.createElement("div");
      tabsBar.className = "sm-tabs";
      const panels = new Map();
      apps.forEach((app, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "win95-btn bevel-out sm-tab-btn";
        btn.dataset.appId = app.id;
        btn.textContent = `${app.icon} ${app.name}`;
        const appPanel = document.createElement("div");
        appPanel.className = "sm-panel";
        appPanel.hidden = idx !== 0;
        panels.set(app.id, appPanel);
        btn.addEventListener("click", () => {
          tabsBar.querySelectorAll(".sm-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.appId === app.id));
          panels.forEach((p, id) => { p.hidden = id !== app.id; });
          if (!appPanel.dataset.rendered) {
            appPanel.dataset.rendered = "1";
            this._renderSocialAppContent(app, appPanel);
          }
        });
        tabsBar.appendChild(btn);
      });
      panel.appendChild(tabsBar);
      apps.forEach((app) => panel.appendChild(panels.get(app.id)));
      if (apps.length > 0) {
        tabsBar.querySelector(".sm-tab-btn")?.classList.add("active");
        const firstPanel = panels.get(apps[0].id);
        firstPanel.dataset.rendered = "1";
        this._renderSocialAppContent(apps[0], firstPanel);
      }
    } catch (err) {
      panel.textContent = `社交媒体加载失败：${err.message}`;
    }
  }

  _renderSocialAppContent(app, panel) {
    const header = document.createElement("div");
    header.className = "sm-app-header";
    header.innerHTML = `<span class="sm-app-icon">${app.icon}</span> <strong>${app.name}</strong>`;
    panel.appendChild(header);

    if (app.timeAdvancePerView > 0) {
      const browseBtn = document.createElement("button");
      browseBtn.type = "button";
      browseBtn.className = "win95-btn bevel-out sm-browse-btn";
      browseBtn.textContent = `📱 浏览（消耗 ${app.timeAdvancePerView} 分钟）`;
      browseBtn.addEventListener("click", () => {
        eventBus.emit("item:inspected", { id: `social_${app.id}`, effect: null, inspectTimeAdvance: app.timeAdvancePerView });
        browseBtn.disabled = true;
        browseBtn.textContent = "（已浏览）";
      });
      panel.appendChild(browseBtn);
    }

    const feed = document.createElement("div");
    feed.className = "sm-feed";
    if (app.id === "qqgroup") {
      (app.groups || []).forEach((group) => {
        const card = document.createElement("div");
        card.className = "sm-group-card panel-inset";
        card.innerHTML = `<div class="sm-group-name">🐧 ${group.name}</div>`;
        const msgList = document.createElement("div");
        msgList.className = "sm-msg-list";
        (group.messages || []).forEach((msg) => {
          const row = document.createElement("div");
          row.className = "sm-msg-row";
          row.innerHTML = `<span class="sm-msg-sender">${msg.sender}：</span><span class="sm-msg-text">${msg.text}</span>`;
          msgList.appendChild(row);
        });
        card.appendChild(msgList);
        feed.appendChild(card);
      });
    } else {
      (app.posts || []).forEach((post) => {
        const card = document.createElement("div");
        card.className = "sm-post-card panel-inset";
        card.innerHTML = `<div class="sm-post-title">${post.title}</div><div class="sm-post-meta">@${post.author}${post.likes != null ? ` · 👍 ${post.likes}` : ""}</div>`;
        if (post.content) {
          const body = document.createElement("p");
          body.className = "sm-post-body";
          body.textContent = post.content;
          card.appendChild(body);
        }
        if (post.answers?.length) {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "win95-btn bevel-out sm-answers-toggle";
          toggle.textContent = `查看 ${post.answers.length} 条回答`;
          const answersEl = document.createElement("div");
          answersEl.className = "sm-answers hidden";
          post.answers.forEach((a, i) => {
            const p = document.createElement("p");
            p.className = "sm-answer";
            p.textContent = `${i + 1}. ${a}`;
            answersEl.appendChild(p);
          });
          toggle.addEventListener("click", () => {
            answersEl.classList.toggle("hidden");
            toggle.textContent = answersEl.classList.contains("hidden") ? `查看 ${post.answers.length} 条回答` : "收起";
          });
          card.appendChild(toggle);
          card.appendChild(answersEl);
        }
        feed.appendChild(card);
      });
    }
    panel.appendChild(feed);
  }

  // ── Clue wall ───────────────────────────────────────────────────────────────
  _showClueWall() {
    const clues = keywordManager.all().filter((kw) => kw.category === "clue" || kw.id === "old_key_clue");
    this.interaction.innerHTML = "<h3>线索墙</h3><p class=\"dorm-clue-wall-note\">红线表示目前已发现线索之间的关联。</p>";
    if (!clues.length) {
      this.interaction.insertAdjacentHTML("beforeend", "<p>还没有足够的线索。与 NPC 交互或调查物品来收集线索。</p>");
      return;
    }
    const width = 620;
    const height = Math.max(170, Math.ceil(clues.length / 3) * 82);
    const board = document.createElement("div");
    board.className = "dorm-clue-wall";
    board.style.setProperty("--clue-wall-height", `${height}px`);
    const positions = clues.map((_, i) => ({ x: 55 + (i % 3) * 250, y: 35 + Math.floor(i / 3) * 82 }));
    board.insertAdjacentHTML("beforeend", `<svg class="dorm-clue-lines" viewBox="0 0 ${width} ${height}" aria-hidden="true">${this._clueConnections(clues, positions)}</svg>`);
    clues.forEach((clue, i) => {
      const node = document.createElement("div");
      node.className = "dorm-clue-node";
      node.style.left = `${positions[i].x}px`;
      node.style.top = `${positions[i].y}px`;
      node.title = clue.content || clue.label || clue.id;
      node.textContent = clue.content || clue.label || clue.id;
      board.appendChild(node);
    });
    this.interaction.appendChild(board);
  }

  _clueConnections(clues, positions) {
    const index = new Map(clues.map((clue, i) => [clue.id, i]));
    const pairs = [];
    const add = (a, b) => { if (index.has(a) && index.has(b)) pairs.push([index.get(a), index.get(b)]); };
    add("old_key_clue", "basement_secret");
    add("night_shift_rumor", "night_shift_rumor_detail");
    add("night_shift_rumor", "night_shift_rumor_echo");
    add("night_shift_injury", "emergency_bruise");
    for (let i = 1; i < clues.length; i += 1) {
      if (!pairs.some(([a, b]) => a === i || b === i)) pairs.push([i - 1, i]);
    }
    return pairs.map(([a, b]) => `<line x1="${positions[a].x}" y1="${positions[a].y}" x2="${positions[b].x}" y2="${positions[b].y}" />`).join("");
  }

  // ── Player menu ─────────────────────────────────────────────────────────────
  _showPlayerMenu() {
    const state = gameState.snapshot();
    const items = itemManager.all();
    this.interaction.innerHTML = `<h3>主角菜单</h3><p>第 ${state.day} 天 · ${dayNightSystem.isDaylight() ? "白天" : "夜晚"} · ${this.clock.textContent}</p><p>精神 ${state.mental} · 体力 ${state.physical} · 精力 ${state.energy} · 饱腹 ${state.satiety}</p>`;
    const itemTitle = document.createElement("h4");
    itemTitle.textContent = "物品";
    this.interaction.appendChild(itemTitle);
    const list = document.createElement("ul");
    items.forEach(({ def, count }) => {
      const row = document.createElement("li");
      row.textContent = `${def.name} x${count}`;
      list.appendChild(row);
    });
    if (!items.length) list.innerHTML = "<li>（空）</li>";
    this.interaction.appendChild(list);
    const save = document.createElement("button");
    save.className = "win95-btn bevel-out";
    save.textContent = "保存游戏";
    save.addEventListener("click", () => {
      saveManager.save();
      this._message("游戏已保存到当前链接。", "success");
    });
    this.interaction.append(save);
  }

  // ── NPC dialogue ────────────────────────────────────────────────────────────
  _showDialogue(actor, keywordDefs) {
    this.interaction.innerHTML = `<h3>与 ${actor.name} 交互</h3>`;
    if (npcStateManager.isOffline(actor.id)) {
      this.interaction.innerHTML += "<p>（对方已经离线，无法交互。）</p>";
      return;
    }
    if (!dayNightSystem.areRoommatesAvailable()) {
      this.interaction.innerHTML += `<p>（${dayNightSystem.areRoommatesSleeping() ? "对方正在睡觉" : "对方正在上班"}，暂时无法交互。）</p>`;
      return;
    }
    const lines = document.createElement("div");
    const options = document.createElement("div");
    options.className = "dialogue-options";
    this.interaction.append(lines, options);
    if (!actor.blueprint) {
      lines.innerHTML = "<p class=\"dialogue-end\">（该内容尚未转换为日程蓝图。）</p>";
      return;
    }
    const instance = realtimeQueue.append([{ scheduleId: actor.id, payload: actor, status: "unresolved", transcript: [] }])[0];
    const runner = createScheduleRunner({
      definition: actor,
      instance,
      appendLine: (speaker, label, text) => {
        const line = document.createElement("p");
        line.innerHTML = `<strong>${label}:</strong> ${keywordManager.renderHighlightedText(text, keywordDefs)}`;
        lines.replaceChildren(line);
        keywordManager.bindHighlights(line, keywordDefs);
      },
      optionsEl: options,
      appId: "dorm",
      onCheckpoint: (next) => realtimeQueue.updateInstance(instance.instanceId, next),
      onComplete: () => realtimeQueue.complete(instance.instanceId),
    });
    runner.start();
  }

  // ── Bed / sleep ─────────────────────────────────────────────────────────────
  _bedAction() {
    const minutes = this._clockMinutes();
    const inWork = minutes >= 8 * 60 && minutes < 16 * 60;
    this.confirmTitle.textContent = inWork ? "去上班确认" : "睡觉确认";
    this.confirmMessage.textContent = inWork
      ? "现在是工作时间，确定直接去上班吗？"
      : "确定睡觉直到次日 08:00 吗？";
    this.confirmPanel.classList.remove("hidden");
    const okButton = this.confirmPanel.querySelector(".dorm-bed-confirm-ok");
    okButton.onclick = () => {
      this.confirmPanel.classList.add("hidden");
      if (inWork) this.launchWorkApp();
      else dayNightSystem.toggle();
    };
    okButton.focus();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  _message(text, className = "") {
    this.interaction.className = "dorm-interaction panel-inset";
    this.interaction.textContent = text;
    if (className) this.interaction.classList.add(className);
  }

  _onStateChanged(detail = {}) {
    const changed = detail.phaseChanged !== false;
    if (changed) this._transition(gameState.location === "dorm");
    else this._syncVisibility(gameState.location === "dorm");
    if (gameState.location === "dorm") this._renderScene();
  }

  _syncVisibility(showDorm) {
    if (!showDorm) this._closeComputer();
    this.root.classList.toggle("hidden", !showDorm);
    this.workShell.classList.toggle("work-mode-active", !showDorm);
    this._renderClock();
  }

  _transition(showDorm) {
    if (this._transitionTimer != null) {
      window.clearTimeout(this._transitionTimer);
      this._transitionTimer = null;
      this.root.classList.remove("mode-transition", "opening-laptop", "closing-laptop");
      this._transitioning = false;
    }
    this._transitioning = true;
    this.root.classList.add("mode-transition", showDorm ? "opening-laptop" : "closing-laptop");
    this._transitionTimer = window.setTimeout(() => {
      this._transitionTimer = null;
      this._syncVisibility(gameState.location === "dorm");
      this.root.classList.remove("mode-transition", "opening-laptop", "closing-laptop");
      this._transitioning = false;
    }, 620);
  }
}
