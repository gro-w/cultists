// Phase 8 "关键词的收集" probe: proves the generic `KeywordManager` (no
// dialogue/his/item specific code) correctly parses `[[id]]`/`[[id|label]]`
// markers, collects/dedupes them, applies the low-SAN distorted-text rule,
// and round-trips through snapshot()/restore() exactly like every other
// SaveManager-owned domain.
import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { DataStructureManager } from "../core/DataStructureManager.js";
import { DataStore } from "../core/DataStore.js";
import { KeywordManager } from "../core/KeywordManager.js";

function makeManager({ sanityProvider } = {}) {
  const eventBus = new EventBus();
  const dataStructureManager = new DataStructureManager();
  dataStructureManager.register({
    id: "keyword",
    fields: [
      { id: "id", type: "string" },
      { id: "content", type: "string" },
      { id: "contentLowSan", type: "string", default: "" },
    ],
  });
  const dataStore = new DataStore(dataStructureManager);
  dataStore.registerDatabase({ databaseId: "keywords", recordType: "keyword" });
  dataStore.createRecord("keywords", { id: "fever", content: "发热" });
  dataStore.createRecord("keywords", { id: "voices", content: "低语声", contentLowSan: "尖叫声" });
  const keywordManager = new KeywordManager({ dataStore, eventBus, sanityProvider });
  return { eventBus, dataStore, keywordManager };
}

// --- idsFromText extracts every marker, deduped, ids only -------------------
{
  const { keywordManager } = makeManager();
  const ids = keywordManager.idsFromText("患者[[fever]]，还有点[[fever|反复发热]]和[[voices]]。");
  assert.deepEqual(ids, ["fever", "voices"]);
}

// --- renderHighlightedText: known id -> clickable span, unknown id -> plain label, never dropped --
{
  const { keywordManager } = makeManager();
  const html = keywordManager.renderHighlightedText("有[[fever]]和[[unknown_id|某症状]]。");
  assert.match(html, /<span class="keyword-highlight" data-keyword-id="fever">发热<\/span>/);
  assert.match(html, /某症状/);
  assert.doesNotMatch(html, /data-keyword-id="unknown_id"/, "unknown ids must not be turned into a clickable span");
}

// --- collect: idempotent, first-collection-only "new" event, unknown id ignored --
{
  const { keywordManager, eventBus } = makeManager();
  const events = [];
  eventBus.on("keyword:collected", (payload) => events.push({ type: "collected", ...payload }));
  eventBus.on("keyword:new", (payload) => events.push({ type: "new", ...payload }));

  keywordManager.collect("fever", 3);
  assert.ok(keywordManager.has("fever"));
  assert.equal(keywordManager.get("fever").collectedDay, 3);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "collected");
  assert.equal(events[1].type, "new");

  // Re-collecting must not re-fire "new" and must keep the original day.
  keywordManager.collect("fever", 9);
  assert.equal(keywordManager.get("fever").collectedDay, 3);
  assert.equal(events.length, 3, "re-collect should only emit one more 'collected', no 'new'");
  assert.equal(events[2].type, "collected");
  assert.equal(events[2].isNew, false);

  // Unknown id: silently ignored, never fabricates an entry.
  keywordManager.collect("no_such_id", 1);
  assert.equal(keywordManager.has("no_such_id"), false);
}

// --- displayContent: SAN < 50 shows the distorted variant when authored ----
{
  let san = 100;
  const { keywordManager } = makeManager({ sanityProvider: () => san });
  assert.equal(keywordManager.displayContent("voices"), "低语声");
  san = 40;
  assert.equal(keywordManager.displayContent("voices"), "尖叫声");
  // A keyword with no contentLowSan authored keeps its normal content even at low SAN.
  assert.equal(keywordManager.displayContent("fever"), "发热");
}

// --- snapshot/restore round trip, dataStore is the source of truth for definitions --
{
  const { keywordManager } = makeManager();
  keywordManager.collect("fever", 2);
  keywordManager.collect("voices", 5);
  const snapshot = keywordManager.snapshot();

  const restored = makeManager().keywordManager;
  restored.restore(snapshot);
  assert.equal(restored.has("fever"), true);
  assert.equal(restored.get("fever").collectedDay, 2);
  assert.equal(restored.all().length, 2);
  // Most-recently-collected first.
  assert.deepEqual(restored.all().map((entry) => entry.id), ["voices", "fever"]);
}

console.log("keyword-manager-probe: all scenarios passed");
