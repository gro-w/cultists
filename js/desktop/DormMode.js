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
import { socialQueue } from "../core/ScheduleQueue.js";
import { dayNightSystem } from "../core/DayNightSystem.js";
import { launchChatGTPApp } from "../apps/ChatGTPApp.js";
import { renderInspectResult } from "../core/InspectFormat.js";
import { checkSkill, OUTCOME_LABELS } from "../core/DiceCheck.js";
import { locationSystem } from "../core/LocationSystem.js";
import { cgManager } from "../core/CGManager.js";

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
  constructor(root, { workShell, launchWorkApp, showLocation = null }) {
    this.root = root;
    this.workShell = workShell;
    this.launchWorkApp = launchWorkApp;
    this._showLocation = showLocation; // (locationId) => void
    this._npcsData = null;
    this.entry = null;
    this._transitioning = false;
    this._computerOpen = false;
    this._compTabInit = {};
    this._transitionTimer = null;
    this._dormSanOff = null;
    this._npcsData = null;
    this._cgOverlay = null;     // global #cg-overlay element
    this._cgOff = [];           // EventBus unsub functions
    /** Map<appId, gameDay> — which day the player already browsed each app */
    this._viewedApps = new Map();
    this._build();
    eventBus.on("daynight:changed", (detail) => this._onStateChanged(detail));
    eventBus.on("time:changed", () => this._renderClock());
    eventBus.on("gamestate:changed", () => this._renderClock());
  }

  async init() {
    this._npcsData = await dataLoader.loadJSON("npcs.json").catch(() => ({ npcs: [] }));
    await locationSystem.load();
    this._updateDormBg();
    if (this._dormSanOff) this._dormSanOff();
    this._dormSanOff = eventBus.on("game:sanity_changed", () => this._updateDormBg());
    // Wire CG overlay (the global #cg-overlay element handles both dorm and location views)
    this._cgOverlay = document.getElementById("cg-overlay");
    this._cgOff.forEach((off) => off());
    this._cgOff = [
      eventBus.on("cg:show", ({ imageData }) => this._onCGShow(imageData)),
      eventBus.on("cg:end",  ()              => this._onCGEnd()),
    ];
    // Restore CG state if game was saved mid-CG
    if (cgManager.isActive) this._onCGShow(cgManager.getDef(cgManager.activeCgId)?.imageData || "");
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
            <button type="button" class="win95-btn bevel-out" data-action="player-menu">🧑 主角</button>
            <button type="button" class="win95-btn bevel-out" data-action="bed">🛏️ 睡觉</button>
            <button type="button" class="win95-btn bevel-out" data-action="clue">🧵 线索墙</button>
            <button type="button" class="win95-btn bevel-out" data-action="computer">🖥️ 电脑</button>
            <button type="button" class="win95-btn bevel-out" data-action="go-restaurant">🍲 火锅店</button>
            <button type="button" class="win95-btn bevel-out" data-action="go-seaside">🌊 海边</button>
          </div>
        </div>

        <div class="dorm-scene-wrap">
          <img class="dorm-scene-bg" alt="" />
          <img class="dorm-cg-bg hidden" alt="CG" />
          <div class="dorm-scene-item-layer"></div>
          <div class="dorm-portrait-layer hidden"></div>
        </div>
        <div class="dorm-npc-strip"></div>

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
    this._bgEl          = this.root.querySelector(".dorm-scene-bg");
    this._cgBgEl        = this.root.querySelector(".dorm-cg-bg");
    this._itemLayer     = this.root.querySelector(".dorm-scene-item-layer");
    this._npcStrip      = this.root.querySelector(".dorm-npc-strip");
    this._portraitLayer = this.root.querySelector(".dorm-portrait-layer");

    this.confirmPanel.querySelector(".dorm-bed-confirm-cancel").addEventListener("click", () => {
      this.confirmPanel.classList.add("hidden");
    });

    this.root.querySelector('[data-action="bed"]').addEventListener("click", () => this._bedAction());
    this.root.querySelector('[data-action="clue"]').addEventListener("click", () => this._showClueWall());
    this.root.querySelector('[data-action="computer"]').addEventListener("click", () => this._openComputer());
    this.root.querySelector('[data-action="player-menu"]').addEventListener("click", () => this._showPlayerMenu());
    this.root.querySelector('[data-action="go-restaurant"]').addEventListener("click", () => {
      if (this._showLocation) this._showLocation("restaurant");
      else this._message("（前往火锅店的通道尚未连接。）");
    });
    this.root.querySelector('[data-action="go-seaside"]').addEventListener("click", () => {
      if (this._showLocation) this._showLocation("seaside");
      else this._message("（前往海边的通道尚未连接。）");
    });

    this.root.querySelectorAll(".dorm-comp-tab-btn[data-comptab]").forEach((btn) => {
      btn.addEventListener("click", () => this._switchCompTab(btn.dataset.comptab));
    });
    this.root.querySelector(".dorm-comp-close").addEventListener("click", () => this._closeComputer());
  }

  // ── Background (sanity-aware) ────────────────────────────────────────────
  _updateDormBg() {
    const img = locationSystem.resolveBackground("dorm", gameState.mental ?? 100);
    if (img) {
      this._bgEl.src = img;
      this._bgEl.hidden = false;
    } else {
      this._bgEl.hidden = true;
    }
  }

  // ── Clock ───────────────────────────────────────────────────────────────────
  _clockMinutes() {
    const start = gameState.phase === "day" ? 8 * 60 : 16 * 60;
    return gameState.clockMinutes;
  }

  _renderClock() {
    const minutes = this._clockMinutes();
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    this.clock.textContent = `Day ${gameState.day}  ${hh}:${mm}`;
  }

  // ── Scene render ────────────────────────────────────────────────────────────
  async _renderScene() {
    this._renderClock();

    // ── NPC buttons in the strip ───────────────────────────────────────────
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

    this._npcStrip.innerHTML = "";
    ["ajie", "awei", "binbin"].forEach((npcId) => {
      const actor = npcMap.get(npcId);
      if (!actor) return;
      const offline = npcStateManager.isOffline(npcId);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `win95-btn bevel-out dorm-npc-strip-btn${offline ? " offline" : ""}`;
      btn.textContent = `${actor.avatar || roommateImage(npcId) ? "" : "🙂"} ${actor.name}`;
      btn.title = offline ? `${actor.name}（暂时离线）` : actor.name;
      if (!offline) btn.addEventListener("click", () => this._showDialogue(actor, keywordDefs));
      else btn.disabled = true;
      this._npcStrip.appendChild(btn);
    });

    // ── Items in the scene ─────────────────────────────────────────────────
    const loc = locationSystem.get("dorm");
    if (loc) this._renderSceneItems(loc);
  }

  /**
   * Render dorm items into the item layer.
   * Three sources (same pattern as LocationScene):
   *   1. ItemPlacementManager — condition-gated placements (item_placements.json)
   *   2. items.json `locations` field entries for "dorm" or "dorm/<subId>"
   *   3. loc.hotspots — dev-placed hotspot markers
   */
  _renderSceneItems(loc) {
    this._itemLayer.innerHTML = "";
    const rendered = new Set();

    // Source 1: condition-gated placements
    itemPlacementManager.visibleFor("dorm").forEach((placement) => {
      const key = `placement:${placement.id}`;
      if (rendered.has(key)) return;
      rendered.add(key);
      const def = itemManager.getDef(placement.itemId);
      const hotspot = placement.hotspot || {};
      this._itemLayer.appendChild(this._makeItemBtn({
        icon: hotspot.icon || def?.icon || "❔",
        label: hotspot.label || def?.name || placement.itemId,
        x: hotspot.x, y: hotspot.y,
        onClick: () => this._inspectPlacedItem(placement.id),
      }));
    });

    // Source 2: items.json locations field
    const defs = itemManager.worldItemsAt("dorm");
    defs.forEach((def) => {
      if (def.layer === "below") return;
      const key = `item:${def.id}`;
      if (rendered.has(key)) return;
      rendered.add(key);
      this._itemLayer.appendChild(this._makeItemBtn({
        icon: def.icon || "📦",
        label: def.name || def.id,
        x: def.sceneX, y: def.sceneY,
        onClick: () => this._inspectWorldItem(def.id),
      }));
    });

    // Source 3: loc.hotspots (dev-placed)
    (loc.hotspots || []).forEach((h) => {
      if (!h.targetId) return;
      const def = itemManager.getDef(h.targetId);
      this._itemLayer.appendChild(this._makeItemBtn({
        icon: h.icon || def?.icon || "👤",
        label: h.label || def?.name || h.targetId,
        x: h.x, y: h.y,
        onClick: () => def ? this._inspectWorldItem(h.targetId) : this._message(`（${h.label || h.targetId}）`),
      }));
    });
  }

  _makeItemBtn({ icon, label, x, y, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn bevel-out loc-item-btn";
    btn.textContent = icon;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    if (x != null && y != null) {
      btn.style.position = "absolute";
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
    }
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ── Item interaction ────────────────────────────────────────────────────────

  /** Inspect a world-placed item (item_placements.json, has take/put-back).
   * At night, if the placement is on a roommate's desk, a stealth check
   * (observation skill) is performed first. Failure: suspicion +20, item hidden. */
  _inspectPlacedItem(placementId) {
    const inspected = itemPlacementManager.inspect(placementId);
    if (!inspected.ok) {
      this._message(inspected.message);
      return;
    }

    // Night stealth check for desk items
    const placement = inspected.placement;
    const isNight = dayNightSystem.areRoommatesSleeping();
    const isDeskItem = typeof placement.zone === "string" && placement.zone.includes("desk");
    if (isNight && isDeskItem) {
      const check = checkSkill("observation");
      const outcomeLabel = OUTCOME_LABELS[check.outcome] ?? check.outcome;
      const passed = check.outcome === "criticalSuccess" || check.outcome === "success";
      if (!passed) {
        // Caught — hide item and raise suspicion
        itemPlacementManager.hideByRoommate(placementId);
        gameState.raiseSuspicion(20);
        this._renderScene();
        const npcName = placement.zone.split("_")[0]; // e.g. "ajie" from "ajie_desk"
        const name = this._npcsData?.npcs?.find?.((n) => n.id === npcName)?.name || "室友";
        this._message(
          `潜行检定 ${outcomeLabel}（掷出 ${check.roll} / 需 ≤ ${check.skillValue}）——${name}醒来发现了你！室友怀疑度 +20，物品被${name}收起。`,
        );
        return;
      }
      // Success — note the roll and proceed
      this.interaction.innerHTML = `<p style="color:#81c784;font-size:12px">潜行检定 ${outcomeLabel}（掷出 ${check.roll}）</p>`;
    }

    const def = itemManager.getDef(placement.itemId);
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
            const loc = locationSystem.get("dorm");
            if (loc) this._renderSceneItems(loc);
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
    this.root.querySelectorAll(".dorm-comp-tab-btn[data-comptab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.comptab === tabId);
    });
    this.root.querySelectorAll(".dorm-computer-panel[data-comppanel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.comppanel !== tabId);
    });
    if (!this._compTabInit[tabId]) {
      this._compTabInit[tabId] = true;
      const panel = this.root.querySelector(`[data-comppanel="${tabId}"]`);
      if (tabId === "chatgtp") {
        this._renderChatGTP(panel);
      } else if (tabId === "social") {
        this._renderSocialMedia(panel);
      }
    }
  }

  async _renderChatGTP(panel) {
    // Launch ChatGTP first so .chatgtp-history is in the DOM before the
    // daily banner's "查看" button tries to append messages into it.
    await launchChatGTPApp({ container: { replaceChildren: (el) => panel.appendChild(el) } })
      .catch((err) => { panel.insertAdjacentHTML("beforeend", `<p>ChatGTP 无法打开：${err.message}</p>`); });

    // Daily preset Q&A banner — one exchange per click, limited to the
    // number of exchanges available for today.
    try {
      const data = await dataLoader.loadJSON("social_apps.json");
      const daily = data.chatgtpDaily || [];
      const day   = gameState.day;
      // Match by day field; fall back to sequential index (day-1) if no exact match
      const entry = daily.find((e) => e.day === day)
        ?? (day <= daily.length ? daily[day - 1] : null);
      const exchanges = entry?.exchanges || [];

      if (exchanges.length === 0) return;

      const viewKey = `chatgtp_daily_${day}`;
      // Persist viewed count in _viewedApps map (survives tab switches this session)
      const getIdx = () => this._viewedApps.get(viewKey) ?? 0;

      const banner = document.createElement("div");
      banner.className = "chatgtp-daily-banner";

      const refreshBanner = () => {
        const idx = getIdx();
        if (idx >= exchanges.length) {
          banner.innerHTML = `<span class="chatgtp-daily-label">📬 今日预设对话：已全部查看（共 ${exchanges.length} 条）。</span>`;
          return;
        }
        banner.innerHTML = `
          <span class="chatgtp-daily-label">📬 今日消息 (${idx + 1}/${exchanges.length})</span>
          <button type="button" class="win95-btn bevel-out chatgtp-daily-btn">查看</button>`;
        banner.querySelector(".chatgtp-daily-btn").addEventListener("click", () => {
          const currentIdx = getIdx();
          if (currentIdx >= exchanges.length) { refreshBanner(); return; }
          const exchange = exchanges[currentIdx];
          const histEl = panel.querySelector(".chatgtp-history");
          if (histEl) {
            const q = document.createElement("div");
            q.className = "chat-bubble bubble-me";
            q.textContent = exchange.q;
            const a = document.createElement("div");
            a.className = "chat-bubble bubble-npc";
            a.textContent = exchange.a;
            histEl.appendChild(q);
            histEl.appendChild(a);
            histEl.scrollTop = histEl.scrollHeight;
          }
          this._viewedApps.set(viewKey, currentIdx + 1);
          refreshBanner();
        });
      };

      refreshBanner();
      // Insert banner before the ChatGTP root so it appears at the top
      panel.insertBefore(banner, panel.firstChild);
    } catch (_) { /* daily section optional */ }
  }

  async _renderSocialMedia(panel) {
    panel.innerHTML = `<div class="sm-loading">加载中…</div>`;
    try {
      const data = await dataLoader.loadJSON("social_apps.json");
      panel.innerHTML = "";
      const apps = data.apps || [];
      const day  = gameState.day;

      const tabsBar = document.createElement("div");
      tabsBar.className = "sm-tabs";
      const panels = new Map();

      apps.forEach((app, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "win95-btn bevel-out sm-tab-btn";
        btn.dataset.appId = app.id;

        // Unread badge
        const unread = app.unreadCount && !this._viewedApps.has("unread_" + app.id);
        btn.innerHTML = `${app.icon} ${app.name}${unread ? `<span class="sm-unread-badge">${app.unreadCount}</span>` : ""}`;

        const appPanel = document.createElement("div");
        appPanel.className = "sm-panel" + (idx !== 0 ? " hidden" : "");
        panels.set(app.id, appPanel);

        btn.addEventListener("click", () => {
          tabsBar.querySelectorAll(".sm-tab-btn").forEach((b) =>
            b.classList.toggle("active", b.dataset.appId === app.id));
          panels.forEach((p, id) => p.classList.toggle("hidden", id !== app.id));
          if (!appPanel.dataset.rendered) {
            appPanel.dataset.rendered = "1";
            this._renderSocialAppContent(app, appPanel, data, day);
          }
        });
        tabsBar.appendChild(btn);
      });

      panel.appendChild(tabsBar);
      apps.forEach((app) => panel.appendChild(panels.get(app.id)));

      // Render first app immediately
      if (apps.length > 0) {
        tabsBar.querySelector(".sm-tab-btn")?.classList.add("active");
        const firstPanel = panels.get(apps[0].id);
        firstPanel.dataset.rendered = "1";
        this._renderSocialAppContent(apps[0], firstPanel, data, day);
      }
    } catch (err) {
      panel.textContent = `社交媒体加载失败：${err.message}`;
    }
  }

  _renderSocialAppContent(app, panel, data, day) {
    const header = document.createElement("div");
    header.className = "sm-app-header";
    header.innerHTML = `<span class="sm-app-icon">${app.icon}</span> <strong>${app.name}</strong><span class="sm-app-desc" style="margin-left:8px">${app.description || ""}</span>`;
    panel.appendChild(header);

    // Daily browse button (once per day per app)
    const viewKey = `browse_${app.id}`;
    const alreadyBrowsed = this._viewedApps.get(viewKey) === day;
    if (app.timeAdvancePerView > 0) {
      const browseBtn = document.createElement("button");
      browseBtn.type = "button";
      browseBtn.className = "win95-btn bevel-out sm-browse-btn";
      if (alreadyBrowsed) {
        browseBtn.textContent = "（今日已浏览）";
        browseBtn.disabled = true;
      } else {
        browseBtn.textContent = `📱 浏览（消耗 ${app.timeAdvancePerView} 分钟）`;
        browseBtn.addEventListener("click", () => {
          this._viewedApps.set(viewKey, day);
          eventBus.emit("item:inspected", { id: `social_${app.id}`, effect: null, inspectTimeAdvance: app.timeAdvancePerView });
          browseBtn.disabled = true;
          browseBtn.textContent = "（今日已浏览）";
        });
      }
      panel.appendChild(browseBtn);
    }

    const feed = document.createElement("div");
    feed.className = "sm-feed";

    if (app.id === "qqgroup") {
      this._renderQQGroups(app, feed, day);
    } else {
      // Pick today's post: seeded-random by day so same day always shows same post
      const posts = app.posts || [];
      if (posts.length > 0) {
        // LCG seed from day + appId hash for per-app variation
        const seed = day * 2654435761 + (app.id || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
        const todayPost = posts[Math.abs(seed >> 8) % posts.length];
        const dayLabel = document.createElement("p");
        dayLabel.style.cssText = "font-size:11px;color:#888;margin:0 0 4px";
        dayLabel.textContent = `第 ${day} 天推荐`;
        feed.appendChild(dayLabel);
        feed.appendChild(this._makePostCard(todayPost, app));
      } else {
        feed.innerHTML = `<p style="color:#aaa;font-size:12px">暂无内容。</p>`;
      }
    }
    panel.appendChild(feed);
  }

  _makePostCard(post, app) {
    const card = document.createElement("div");
    card.className = "sm-post-card panel-inset";
    card.innerHTML = `<div class="sm-post-title">${post.title}</div><div class="sm-post-meta">@${post.author || "匿名"}${post.likes != null ? ` · 👍 ${post.likes}` : ""}</div>`;
    if (post.content) {
      const body = document.createElement("p");
      body.className = "sm-post-body";
      body.textContent = post.content;
      card.appendChild(body);
    }
    if (post.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "sm-post-tags";
      post.tags.forEach((t) => {
        const span = document.createElement("span");
        span.className = "sm-tag";
        span.textContent = `# ${t}`;
        tags.appendChild(span);
      });
      card.appendChild(tags);
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
        toggle.textContent = answersEl.classList.contains("hidden")
          ? `查看 ${post.answers.length} 条回答` : "收起";
      });
      card.appendChild(toggle);
      card.appendChild(answersEl);
    }
    return card;
  }

  _renderQQGroups(app, feed, day) {
    // Unread group message (only first time today)
    const unreadKey = "unread_" + app.id;
    const hasUnread = !this._viewedApps.has(unreadKey);
    const unreadGroup = (app.groups || []).find((g) => g.unread);

    if (hasUnread && unreadGroup?.unreadMessage) {
      const notice = document.createElement("div");
      notice.className = "sm-post-card panel-inset";
      notice.style.cssText = "border-color:#e53935;cursor:pointer";
      notice.innerHTML = `<div class="sm-post-title" style="color:#e53935">🔔 有未读消息</div>
        <div class="sm-msg-row" style="margin-top:4px">
          <span class="sm-msg-sender">${unreadGroup.unreadMessage.sender}：</span>
          <span class="sm-msg-text">${unreadGroup.unreadMessage.text}</span>
        </div>`;
      notice.addEventListener("click", () => {
        this._viewedApps.set(unreadKey, day);
        notice.remove();
        // TODO: trigger "save group member" event when implemented
        this._message("（「拯救群友」事件功能尚未实现。）");
      });
      feed.appendChild(notice);
    }

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
    this.interaction.innerHTML = `<h3>主角菜单</h3>
      <p>第 ${state.day} 天 · ${dayNightSystem.isDaylight() ? "☀ 白天" : "🌙 夜晚"} · ${this.clock.textContent}</p>
      <p>理智 ${state.sanity} · 室友怀疑度 ${state.roommateSuspicion}</p>`;
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

    // Skip-work button (visible during work hours while in dorm)
    const clock = gameState.clockMinutes;
    const isWorkHours = !dayNightSystem.isRestDay() && clock >= 8 * 60 && clock < 16 * 60;
    const isOffDuty = gameState.duty === "off-duty";
    if (isWorkHours && isOffDuty) {
      const skipBtn = document.createElement("button");
      skipBtn.className = "win95-btn bevel-out";
      skipBtn.textContent = "跳过上班（怀疑度 +10）";
      skipBtn.addEventListener("click", () => {
        const result = dayNightSystem.skipWork();
        if (result.ok) {
          gameState.raiseSuspicion(10);
          this._message("你在宿舍度过了工作时间。室友怀疑度上升了。", "");
        }
      });
      this.interaction.appendChild(skipBtn);
    }

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
  /**
   * Resolve the correct portrait image for an NPC at the current sanity level.
   * npcs.json schema: npc.portraits = [{ sanMin, sanMax, imageData, offsetX, offsetY, height }]
   * Falls back to null if no portrait matches or no portraits defined.
   */
  _resolvePortrait(npcId) {
    const npc = this._npcsData?.npcs?.find?.((n) => n.id === npcId);
    if (!npc?.portraits?.length) return null;
    const san = gameState.sanity ?? 100;
    const match = npc.portraits.find((p) => {
      const okMin = p.sanMin == null || san >= p.sanMin;
      const okMax = p.sanMax == null || san <= p.sanMax;
      return okMin && okMax && p.imageData;
    });
    if (!match) return null;
    return {
      imageData: match.imageData,
      offsetX: match.offsetX ?? npc.portraitOffsetX ?? 0,
      offsetY: match.offsetY ?? npc.portraitOffsetY ?? 0,
      height: match.height ?? npc.portraitHeight ?? 66, // % of scene height
    };
  }

  _showPortrait(npcId) {
    if (!this._portraitLayer) return;
    const portrait = this._resolvePortrait(npcId);
    if (!portrait) { this._hidePortrait(); return; }
    this._portraitLayer.innerHTML = `<img
      class="dorm-portrait-img"
      src="${portrait.imageData}"
      alt=""
      style="height:${portrait.height}%;left:${portrait.offsetX}px;bottom:${portrait.offsetY}px"
      draggable="false">`;
    this._portraitLayer.classList.remove("hidden");
    this._portraitLayer.onclick = () => this._hidePortrait();
  }

  _hidePortrait() {
    if (!this._portraitLayer) return;
    this._portraitLayer.classList.add("hidden");
    this._portraitLayer.innerHTML = "";
  }

  _showDialogue(actor, keywordDefs) {
    this._showPortrait(actor.id ?? actor.npcId);
    this.interaction.innerHTML = `<h3>与 ${actor.name} 交互</h3>`;
    const npcId = actor.npcId || actor.payload?.npcId || actor.id;
    if (npcStateManager.isOffline(npcId)) {
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
    const pending = socialQueue.getPending().find((item) =>
      (item.payload?.npcId || item.payload?.id) === npcId
    );
    if (!pending) {
      lines.innerHTML = "<p class=\"dialogue-end\">（没有新的对话内容了。）</p>";
      return;
    }
    const definition = pending.payload || actor;
    if (!definition.blueprint) {
      lines.innerHTML = "<p class=\"dialogue-end\">（该内容尚未转换为日程蓝图。）</p>";
      return;
    }
    const runner = createScheduleRunner({
      definition,
      instance: pending,
      appendLine: (speaker, label, text) => {
        const line = document.createElement("p");
        line.innerHTML = `<strong>${label}:</strong> ${keywordManager.renderHighlightedText(text, keywordDefs)}`;
        lines.replaceChildren(line);
        keywordManager.bindHighlights(line, keywordDefs);
      },
      optionsEl: options,
      appId: "dorm",
      onCheckpoint: (next) => socialQueue.updateInstance(pending.instanceId, next),
      onComplete: () => socialQueue.complete(pending.instanceId),
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

  // ── CG overlay ──────────────────────────────────────────────────────────────

  /**
   * Show a CG background inside the dorm scene-wrap.
   * - The `.dorm-cg-bg` image replaces the normal dorm background visually
   *   (it sits between scene-bg and item-layer in the z-stack).
   * - The item layer gets `pointer-events:none` + opacity 0.15 so items are
   *   visually suppressed and not clickable.
   * - The #cg-overlay element (fixed, full-screen, z-index 2050) is also shown
   *   so LocationScene and any other surface get the same CG background.
   */
  _onCGShow(imageData) {
    if (this._cgBgEl) {
      this._cgBgEl.src = imageData || "";
      this._cgBgEl.classList.toggle("hidden", !imageData);
    }
    // Suppress item layer interaction
    if (this._itemLayer) {
      this._itemLayer.classList.add("cg-active-layer");
    }
    // Show global overlay (covers LocationScene too)
    if (this._cgOverlay) {
      const img = this._cgOverlay.querySelector("img") || document.createElement("img");
      img.alt = "CG";
      img.className = "cg-overlay-img";
      img.src = imageData || "";
      if (!this._cgOverlay.contains(img)) this._cgOverlay.appendChild(img);
      this._cgOverlay.classList.remove("hidden");
    }
  }

  _onCGEnd() {
    if (this._cgBgEl) {
      this._cgBgEl.src = "";
      this._cgBgEl.classList.add("hidden");
    }
    if (this._itemLayer) {
      this._itemLayer.classList.remove("cg-active-layer");
    }
    if (this._cgOverlay) {
      this._cgOverlay.classList.add("hidden");
    }
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
