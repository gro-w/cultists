import { windowManager } from "./WindowManager.js";
import { eventBus } from "./EventBus.js";
import { spellManager } from "./SpellManager.js";

/**
 * SpellLearnDialog — subscribes to the "book:learnSpell" event emitted by
 * ItemManager.use() when a usable book with spells[] is used (0 < SAN ≤ 50).
 *
 * Opens a Win95-style window listing the spells in that book. For each spell
 * the player can click "学习" to learn it; learning a spell:
 *   1. Calls spellManager.learn(spell)
 *   2. Emits "spell:learned" so ActionBudget charges 240 min (4 hours)
 *
 * Already-known spells are shown greyed out with "已知晓" instead.
 * The window closes itself once all spells are either learned or dismissed.
 *
 * This module only needs to be imported once at boot (no exported function
 * called by callers — the subscription wires itself up automatically).
 */

/**
 * Build the spell-learning window for a given book's spells payload.
 * @param {{ id: string, bookName: string, spells: object[] }} payload
 */
function openLearnWindow({ id: bookId, bookName, spells }) {
  if (!spells || spells.length === 0) return;

  const root = document.createElement("div");
  root.style.cssText = "padding:10px 14px;display:flex;flex-direction:column;gap:12px;font-size:13px;";

  const intro = document.createElement("p");
  intro.style.cssText = "color:#555;margin:0;line-height:1.5";
  intro.textContent = `在 0 < SAN ≤ 50 时研读《${bookName}》，你从中窥见了以下法术。每学习一个法术消耗 4 小时。施放每次消耗 5 SAN。`;
  root.appendChild(intro);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:10px;";
  root.appendChild(list);

  function rebuildList() {
    list.innerHTML = "";
    spells.forEach((s, idx) => {
      const spellId = `${bookId}__${idx}`;
      const known = spellManager.knows(spellId);

      const row = document.createElement("div");
      row.style.cssText = `border:1px solid ${known ? "#ccc" : "#90a4ae"};border-radius:4px;` +
        `padding:8px 10px;background:${known ? "#f5f5f5" : "#e3f2fd"};display:flex;gap:10px;align-items:flex-start;`;

      const info = document.createElement("div");
      info.style.cssText = "flex:1;";
      info.innerHTML = `<strong style="font-size:13px;color:${known ? "#999" : "#1565c0"}">${s.name}</strong>` +
        `<p style="margin:4px 0 0;color:#444;font-size:12px;line-height:1.5">${s.description || "（无效果描述）"}</p>` +
        `<p style="margin:4px 0 0;color:#888;font-size:11px">⏱ 学习 4h &nbsp;·&nbsp; 💀 施放 5 SAN</p>`;

      const btn = document.createElement("button");
      btn.className = "win95-btn bevel-out";
      btn.style.cssText = "flex-shrink:0;align-self:center;min-width:54px;";

      if (known) {
        btn.textContent = "已知晓";
        btn.disabled = true;
      } else {
        btn.textContent = "学习";
        btn.addEventListener("click", () => {
          const learned = spellManager.learn({
            id: spellId,
            name: s.name,
            description: s.description || "",
            learnTimeMinutes: 240,
            castSanCost: 5,
            sourceBookId: bookId,
            sourceBookName: bookName,
            spellIndex: idx,
          });
          if (learned) {
            // ActionBudget listens to this and charges 240 min
            eventBus.emit("spell:learned", { spellId, bookId, bookName });
          }
          rebuildList();
        });
      }

      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  rebuildList();

  windowManager.createWindow({
    appId: `spell-learn-${bookId}`,
    title: `学习法术 — ${bookName}`,
    icon: "✨",
    width: 400,
    height: 340,
    content: root,
  });
}

// Wire up once at module import — no explicit init() call needed.
eventBus.on("book:learnSpell", openLearnWindow);
