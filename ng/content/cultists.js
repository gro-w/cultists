import { AchievementSystem } from "./cultists/AchievementSystem.js";
import { ItemManager } from "./cultists/ItemManager.js";
import { KeywordManager } from "./cultists/KeywordManager.js";
import { DialogueWidget } from "./cultists/DialogueWidget.js";

/**
 * Cultists content package. The platform supplies only gateways; this module
 * owns all Cultists-specific runtime systems, collections and APIs.
 */
export function createContentPackage({ eventBus, dataStore, publicVariables, variableStore } = {}) {
  const itemManager = new ItemManager({ eventBus });
  itemManager.loadDefinitions(dataStore.findRecords("inventoryItems", {}));

  const keywordManager = new KeywordManager({
    dataStore,
    eventBus,
    sanityProvider: () => publicVariables.get(1),
  });

  const achievementSystem = new AchievementSystem({
    eventBus,
    records: dataStore.findRecords("achievements", {}),
  });

  const chatgtpKeywords = () => {
    const collected = keywordManager.all();
    const diseases = dataStore.findRecords("diagnoses", {}).map((record) => ({
      id: `disease:${record.id}:normal`,
      content: record.normalName,
      source: "disease",
      category: record.categoryId,
    }));
    const medicines = dataStore.findRecords("medicines", {}).map((record) => ({
      id: record.id,
      content: record.name,
      source: "medicine",
      category: record.categoryId,
    }));
    const notebook = collected.map((record) => ({
      ...record,
      source: "notebook",
      category: record.category || "全部",
    }));
    return [...new Map([...notebook, ...diseases, ...medicines].map((record) => [record.id, record])).values()];
  };

  const chatgtpCategoryOptions = () => {
    const source = variableStore.get("chatgtp:source") || "notebook";
    return [...new Set(chatgtpKeywords().filter((record) => record.source === source).map((record) => record.category || "全部"))]
      .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"))
      .map((id) => ({ value: id, label: id }));
  };

  const chatgtpKeywordOptions = () => {
    const source = variableStore.get("chatgtp:source") || "notebook";
    const category = variableStore.get("chatgtp:category") || "";
    return chatgtpKeywords()
      .filter((record) => record.source === source && (!category || record.category === category))
      .map((record) => ({ value: record.id, label: record.content, id: record.id, content: record.content }));
  };

  variableStore.set("chatgtp:keywords", chatgtpKeywords());
  eventBus.on("keyword:collected", () => variableStore.set("chatgtp:keywords", chatgtpKeywords()));
  eventBus.on("keyword:removed", () => variableStore.set("chatgtp:keywords", chatgtpKeywords()));

  const runtimeGateway = {
    getCollection(collectionId) {
      if (collectionId === "keywords") return keywordManager.all();
      if (collectionId === "chatgtpKeywords") return chatgtpKeywords();
      if (collectionId === "chatgtpCategories") return chatgtpCategoryOptions();
      if (collectionId === "chatgtpKeywordOptions") return chatgtpKeywordOptions();
      if (collectionId === "achievementStates") return [...achievementSystem.records.values()].map((record) => ({
        id: record.id,
        statusMark: achievementSystem.unlocked.has(record.id) ? "✅" : "⬜",
        statusClass: achievementSystem.unlocked.has(record.id) ? "unlocked" : "locked",
        title: record.title,
        name: record.title,
        unlocked: achievementSystem.unlocked.has(record.id),
        description: achievementSystem.unlocked.has(record.id) ? record.description : "未解锁",
      }));
      if (collectionId === "inventoryItems") return itemManager.allDefinitions()
        .map((definition) => ({ ...definition, count: itemManager.count(definition.id), owned: itemManager.has(definition.id) }))
        .filter((item) => item.owned);
      return [];
    },
  };

  return {
    itemManager,
    keywordManager,
    achievementSystem,
    runtimeGateway,
    customWidgetFactories: { dialogue: DialogueWidget },
    stateProviders: { keywords: keywordManager },
    saveableVariable: (key, value) => !["calendar:days", "achievements:items", "event:value", "query:records"].includes(key)
      && !String(key).startsWith("gameState:")
      && !String(key).startsWith("__")
      && (value === null || ["boolean", "number", "string"].includes(typeof value)),
    runtimeStores: {
      achievements: achievementSystem,
      items: {
        snapshot: () => ({ inventory: itemManager.inventorySnapshot(), placements: itemManager.placementsSnapshot() }),
        restore: (state = {}) => {
          itemManager.inventory = new Map(Object.entries(state.inventory || {}));
          itemManager.placements = new Map((state.placements || []).map((placement) => [String(placement.id), structuredClone(placement)]));
          eventBus.emit("inventory:changed", itemManager.inventorySnapshot());
        },
      },
    },
    bindRuntime({ runActivity } = {}) {
      achievementSystem.runActivity = runActivity;
    },
    installDisplayReceivers({ dialogueRegistry } = {}) {
      eventBus.on("dialogue:text", (payload) => dialogueRegistry.dispatch(payload?.displayTo, { ...payload, type: "text" }));
      eventBus.on("dialogue:choice", (payload) => dialogueRegistry.dispatch(payload?.displayTo, { ...payload, type: "choice" }));
    },
    registerApis(apiGateway, { activityDefinitionStore, enqueueActivity } = {}) {
      apiGateway.register("content.itemAction", ({ itemId, action }) => {
        const definition = itemManager.getDefinition(itemId);
        if (!definition) return { ok: false, reason: "unknown-item" };
        const blueprint = definition.activities?.[action === "inspect" ? "investigate" : action];
        if (!blueprint) return { ok: false, reason: "activity-not-defined" };
        const activityId = `content.item.${itemId}.${action}`;
        activityDefinitionStore.register({ id: activityId, blueprint });
        const instance = enqueueActivity(activityId, "main", { itemId, action });
        return { ok: true, action, activityId, instanceId: instance.instanceId };
      });
    },
  };
}

export default createContentPackage;
