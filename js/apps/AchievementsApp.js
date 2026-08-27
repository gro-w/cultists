import { i18n } from "../core/I18n.js";
import { windowManager } from "../core/WindowManager.js";
import { achievementManager } from "../core/AchievementManager.js";
import { eventBus } from "../core/EventBus.js";

/**
 * AchievementsApp – Win95-styled window listing all achievements.
 *
 * Layout:
 *   ┌─ 全部 · 已解锁 · 未解锁 ────── (tab bar)
 *   ├─ [category filter dropdown]
 *   └─ scrollable achievement grid
 *       ┌──────────────────────────────┐
 *       │ 🏆  题之意志    [已解锁 ✔]  │
 *       │ 第一次放弃宿舍活动，独自…    │
 *       │ 分类: 刷题                   │
 *       └──────────────────────────────┘
 *
 * Secret (hidden) achievements that are NOT yet unlocked show "？？？？"
 * as the title and a generic hint as the description.
 *
 * Progress achievements show a small counter bar when in progress.
 *
 * The window live-updates on `achievement:unlocked` so a new unlock is
 * reflected immediately without reopening.
 */
export async function launchAchievementsApp() {
  await achievementManager.init();

  const root = document.createElement("div");
  root.className = "app-achievements";

  root.innerHTML = `
    <div class="ach-toolbar">
      <div class="ach-tabs">
        <button class="win95-btn bevel-out ach-tab active" data-filter="all">全部</button>
        <button class="win95-btn bevel-out ach-tab" data-filter="unlocked">已解锁</button>
        <button class="win95-btn bevel-out ach-tab" data-filter="locked">未解锁</button>
      </div>
      <select class="win95-input ach-category-select">
        <option value="">所有分类</option>
      </select>
    </div>
    <div class="ach-summary panel-inset"></div>
    <div class="ach-list panel-inset"></div>
  `;

  const tabBtns = [...root.querySelectorAll(".ach-tab")];
  const categorySelect = root.querySelector(".ach-category-select");
  const summaryEl = root.querySelector(".ach-summary");
  const listEl = root.querySelector(".ach-list");

  let currentFilter = "all";
  let currentCategory = "";

  // Populate category dropdown
  const cats = achievementManager.categories || {};
  Object.entries(cats).forEach(([id, label]) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    categorySelect.appendChild(opt);
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  function renderSummary() {
    const all = achievementManager.getAllAchievements();
    const unlocked = all.filter(({ state }) => state && state.unlocked).length;
    summaryEl.textContent = `成就进度：${unlocked} / ${all.length}`;
  }

  function renderList() {
    listEl.innerHTML = "";
    let items = achievementManager.getAllAchievements();

    // Filter by tab
    if (currentFilter === "unlocked") {
      items = items.filter(({ state }) => state && state.unlocked);
    } else if (currentFilter === "locked") {
      items = items.filter(({ state }) => !state || !state.unlocked);
    }

    // Filter by category
    if (currentCategory) {
      items = items.filter(({ def }) => def && def.category === currentCategory);
    }

    if (items.length === 0) {
      listEl.innerHTML = '<p class="his-empty">没有符合条件的成就。</p>';
      return;
    }

    items.forEach(({ def, state }) => {
      if (!def) return;
      const isUnlocked = state && state.unlocked;
      const isSecret = def.hidden && !isUnlocked;

      const card = document.createElement("div");
      card.className = `ach-card${isUnlocked ? " ach-unlocked" : " ach-locked"}${isSecret ? " ach-secret" : ""}`;

      const icon = isSecret ? "🔒" : (def.icon || "🏅");
      const title = isSecret ? "？？？？" : def.title;
      const description = isSecret
        ? "探索更多内容以解锁此隐藏成就。"
        : def.description;
      const catLabel = def.category && cats[def.category] ? cats[def.category] : "";
      const dateStr = isUnlocked && state.unlockedAt
        ? `解锁于 ${new Date(state.unlockedAt).toLocaleDateString("zh-CN")}`
        : "";

      // Progress bar (only for progress-type achievements)
      let progressHtml = "";
      if (def.trigger && def.trigger.progress && !isUnlocked && !isSecret && state) {
        const target = def.trigger.target || 1;
        const pct = Math.min(100, Math.round((state.progress / target) * 100));
        progressHtml = `
          <div class="ach-progress-wrap">
            <div class="ach-progress-bar bevel-in">
              <div class="ach-progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="ach-progress-label">${state.progress} / ${target}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="ach-card-header">
          <span class="ach-icon">${icon}</span>
          <span class="ach-title">${title}</span>
          <span class="ach-status">${isUnlocked ? "✔ 已解锁" : ""}</span>
        </div>
        <p class="ach-desc">${description}</p>
        ${catLabel ? `<p class="ach-meta">分类：${catLabel}${dateStr ? "　" + dateStr : ""}</p>` : ""}
        ${progressHtml}
      `;

      listEl.appendChild(card);
    });
  }

  function renderAll() {
    renderSummary();
    renderList();
  }

  // ── Tab / filter handlers ────────────────────────────────────────────────

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  categorySelect.addEventListener("change", () => {
    currentCategory = categorySelect.value;
    renderList();
  });

  // ── Live-update on unlock ────────────────────────────────────────────────

  const offUnlock = achievementManager.onUnlocked(() => renderAll());

  // ── Initial render ───────────────────────────────────────────────────────

  renderAll();

  return windowManager.createWindow({
    appId: "achievements",
    title: i18n.t("apps.achievements", "成就"),
    icon: "🏆",
    width: 440,
    height: 480,
    content: root,
    onClose: () => {
      offUnlock();
    },
  });
}
