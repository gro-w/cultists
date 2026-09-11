import { eventBus } from "./EventBus.js";

/**
 * Routes blueprint presentation commands to the currently mounted UI surface.
 * Activities declare a target; queues and runners do not know how that target
 * is rendered.
 */
class DisplayReceiverManager {
  constructor() {
    this._receivers = new Map();
  }

  register(target, receiver) {
    if (!target || typeof receiver !== "function") throw new Error("Display receiver requires a target and function");
    const receivers = this._receivers.get(target) || new Set();
    receivers.add(receiver);
    this._receivers.set(target, receivers);
    return () => {
      receivers.delete(receiver);
      if (!receivers.size) this._receivers.delete(target);
    };
  }

  dispatch(target, payload = {}) {
    const receivers = this._receivers.get(target);
    if (!receivers?.size) {
      eventBus.emit("display:unhandled", { target, ...payload });
      return false;
    }
    // A target represents one visible presentation surface. If an old surface
    // was not unmounted yet, the newest registration is authoritative.
    [...receivers].at(-1)(payload);
    return true;
  }

  clear(target) {
    if (target) this._receivers.delete(target);
    else this._receivers.clear();
  }
}

export const displayReceiverManager = new DisplayReceiverManager();
export default DisplayReceiverManager;
