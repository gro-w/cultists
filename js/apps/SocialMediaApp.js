import { windowManager } from "../core/WindowManager.js";
import { dataLoader } from "../core/DataLoader.js";
import { eventBus } from "../core/EventBus.js";
import { actionBudget } from "../core/ActionBudget.js";

/**
 * SocialMediaApp — 吱乎 / 小绿书 / 企鹅群 三合一窗口应用。
 * 数据从 data/<lang>/social_apps.json 读取；浏览每个应用消耗 timeAdvancePerView 分钟。
 */
export async function launchSocialMediaApp(options = {}) {
  const existing = windowManager.getByAppId("social-media");
  if (existing) {
    windowManager.focus(existing.id);
    return existing;
  }

  const data = await dataLoader.loadJSON("social_apps.json");
  const apps = data.apps || [];

  const root = document.createElement("div");
  root.className = "app-social-media";

  // ── tabs bar ──────────────────────────────────────────────────────────────
  const tabsBar = document.createElement("div");
  tabsBar.className = "sm-tabs";

  const panels = new Map();
  apps.forEach((app, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "win95-btn bevel-out sm-tab-btn";
    btn.dataset.appId = app.id;
    btn.textContent = `${app.icon} ${app.name}`;
    btn.addEventListener("click", () => showApp(app.id));
    tabsBar.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "sm-panel";
    panel.hidden = idx !== 0;
    panels.set(app.id, panel);
  });

  root.appendChild(tabsBar);
  apps.forEach((app) => root.appendChild(panels.get(app.id)));

  // ── render ────────────────────────────────────────────────────────────────
  function showApp(appId) {
    const app = apps.find((a) => a.id === appId);
    if (!app) return;

    // Mark active tab
    tabsBar.querySelectorAll(".sm-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.appId === appId);
    });
    panels.forEach((panel, id) => { panel.hidden = id !== appId; });

    const panel = panels.get(appId);
    // Only render once
    if (panel.dataset.rendered) return;
    panel.dataset.rendered = "1";
    renderAppContent(app, panel);
  }

  function renderAppContent(app, panel) {
    const header = document.createElement("div");
    header.className = "sm-app-header";
    header.innerHTML = `<span class="sm-app-icon">${app.icon}</span><strong>${app.name}</strong><span class="sm-app-desc">${app.description || ""}</span>`;
    panel.appendChild(header);

    // Advance time once when opening this tab
    if (app.timeAdvancePerView > 0) {
      const browseBtn = document.createElement("button");
      browseBtn.type = "button";
      browseBtn.className = "win95-btn bevel-out sm-browse-btn";
      browseBtn.textContent = `📱 浏览（消耗 ${app.timeAdvancePerView} 分钟）`;
      browseBtn.addEventListener("click", () => {
        eventBus.emit("item:inspected", {
          id: `social_${app.id}`,
          effect: null,
          inspectTimeAdvance: app.timeAdvancePerView,
        });
        if (app.statChanges && Object.keys(app.statChanges).length > 0) {
          eventBus.emit("gamestate:modify", { changes: app.statChanges });
        }
        browseBtn.disabled = true;
        browseBtn.textContent = "（已浏览）";
      });
      panel.appendChild(browseBtn);
    }

    const feed = document.createElement("div");
    feed.className = "sm-feed";

    if (app.id === "qqgroup") {
      renderGroups(app, feed);
    } else {
      renderPosts(app, feed);
    }

    panel.appendChild(feed);
  }

  function renderPosts(app, container) {
    (app.posts || []).forEach((post) => {
      const card = document.createElement("div");
      card.className = "sm-post-card panel-inset";

      const title = document.createElement("div");
      title.className = "sm-post-title";
      title.textContent = post.title;

      const meta = document.createElement("div");
      meta.className = "sm-post-meta";
      meta.textContent = `@${post.author}${post.likes != null ? `  ·  👍 ${post.likes}` : ""}`;

      card.appendChild(title);
      card.appendChild(meta);

      if (post.content) {
        const body = document.createElement("p");
        body.className = "sm-post-body";
        body.textContent = post.content;
        card.appendChild(body);
      }

      if (post.tags && post.tags.length > 0) {
        const tags = document.createElement("div");
        tags.className = "sm-post-tags";
        post.tags.forEach((tag) => {
          const span = document.createElement("span");
          span.className = "sm-tag";
          span.textContent = `#${tag}`;
          tags.appendChild(span);
        });
        card.appendChild(tags);
      }

      if (post.answers && post.answers.length > 0) {
        const answersToggle = document.createElement("button");
        answersToggle.type = "button";
        answersToggle.className = "win95-btn bevel-out sm-answers-toggle";
        answersToggle.textContent = `查看 ${post.answers.length} 条回答`;
        const answersEl = document.createElement("div");
        answersEl.className = "sm-answers hidden";
        post.answers.forEach((ans, i) => {
          const a = document.createElement("p");
          a.className = "sm-answer";
          a.innerHTML = `<span class="sm-answer-num">${i + 1}.</span> ${ans}`;
          answersEl.appendChild(a);
        });
        answersToggle.addEventListener("click", () => {
          answersEl.classList.toggle("hidden");
          answersToggle.textContent = answersEl.classList.contains("hidden")
            ? `查看 ${post.answers.length} 条回答`
            : "收起";
        });
        card.appendChild(answersToggle);
        card.appendChild(answersEl);
      }

      container.appendChild(card);
    });
  }

  function renderGroups(app, container) {
    (app.groups || []).forEach((group) => {
      const card = document.createElement("div");
      card.className = "sm-group-card panel-inset";

      const name = document.createElement("div");
      name.className = "sm-group-name";
      name.textContent = `🐧 ${group.name}`;
      card.appendChild(name);

      const msgList = document.createElement("div");
      msgList.className = "sm-msg-list";
      (group.messages || []).forEach((msg) => {
        const row = document.createElement("div");
        row.className = "sm-msg-row";
        row.innerHTML = `<span class="sm-msg-sender">${msg.sender}：</span><span class="sm-msg-text">${msg.text}</span>`;
        msgList.appendChild(row);
      });
      card.appendChild(msgList);
      container.appendChild(card);
    });
  }

  // Show first app by default
  if (apps.length > 0) showApp(apps[0].id);

  return windowManager.createWindow({
    appId: "social-media",
    title: "📱 社交媒体",
    content: root,
    width: 560,
    height: 480,
  });
}
