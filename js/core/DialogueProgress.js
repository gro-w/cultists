import { eventBus } from "./EventBus.js";

/**
 * DialogueProgress - tiny singleton tracking "how far" the player has
 * gotten in the currently-open HIS / Social conversation: which
 * actor (patient/contact) is selected and which dialogue node was last
 * shown. Used to:
 *   - restore the conversation view if the app window is re-opened, and
 *   - be encoded/decoded by SaveManager as the "对话展开状态" part of a save.
 *
 * Only the *current* schedule entry's conversation matters here (once the
 * day/phase changes, the actor list changes and old progress becomes moot),
 * which keeps the saved state small.
 */
class DialogueProgress {
  constructor() {
    this.his = { actorId: null, nodeId: null };
    this.social = { actorId: null, nodeId: null };
    this.chatgtp = { actorId: "chatgtp", nodeId: null };
  }

  set(app, actorId, nodeId) {
    if (app !== "his" && app !== "social" && app !== "chatgtp") return;
    this[app] = { actorId, nodeId };
    eventBus.emit("dialogueProgress:changed", { app, actorId, nodeId });
  }

  get(app) {
    return this[app] || { actorId: null, nodeId: null };
  }

  reset(app) {
    this.set(app, null, null);
  }
}

export const dialogueProgress = new DialogueProgress();
export default DialogueProgress;
