import { eventBus } from "../core/EventBus.js";
import { ItemManager } from "../core/ItemManager.js";
import { SpellManager } from "../core/SpellManager.js";
import { MediaStateManager } from "../core/MediaStateManager.js";
import { SelectionSubmissionManager } from "../core/SelectionSubmissionManager.js";
import { LegacyContentEventGateway } from "../core/LegacyContentEventGateway.js";

const itemManager = new ItemManager({ eventBus });
const spellManager = new SpellManager({ eventBus });
const mediaStateManager = new MediaStateManager({ eventBus });
const selectionSubmissionManager = new SelectionSubmissionManager({ eventBus });
new LegacyContentEventGateway({ eventBus, itemManager, spellManager, mediaStateManager, selectionSubmissionManager }).connect();

const media = [];
const his = [];
eventBus.on("media:cg", (payload) => media.push(payload));
eventBus.on("media:end-cg", (payload) => media.push({ end: true, ...payload }));
eventBus.on("his:refresh", (payload) => his.push(payload));

eventBus.emit("content:showCg", { cgId: "cg_probe" });
eventBus.emit("content:endCg", {});
eventBus.emit("content:inventoryOperation", { itemId: "key", count: 2 });
eventBus.emit("content:inventoryOperation", { itemId: "key", count: -1 });
eventBus.emit("content:hisRefresh", { query: "" });
eventBus.emit("content:hisSelectPatient", { patientId: "p1" });
eventBus.emit("content:hisSubmit", {});
if (itemManager.count("key") !== 1) throw new Error("inventory operation was not applied");
if (!mediaStateManager.get("cg_probe")?.unlocked || media.length !== 2) throw new Error("CG event lifecycle was not applied");
if (his.length !== 1 || selectionSubmissionManager.get("his")?.selected !== "p1") throw new Error("HIS event lifecycle was not applied");
console.log("legacy-content-event-gateway-probe: ok", JSON.stringify({ inventory: itemManager.inventorySnapshot(), media, his, submission: selectionSubmissionManager.get("his") }));
