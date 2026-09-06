/** Routes opaque Activity display events to the currently mounted receiver for a data-declared target. */
export class DisplayReceiverRegistry {
  constructor() {
    this.receivers = new Map();
  }

  register(target, receiver) {
    if (!target || !receiver || typeof receiver.handle !== "function") throw new Error("Display receiver requires a target and handle(payload)");
    this.receivers.set(target, receiver);
    return () => {
      if (this.receivers.get(target) === receiver) this.receivers.delete(target);
    };
  }

  dispatch(target, payload) {
    const receiver = this.receivers.get(target);
    if (!receiver) return false;
    receiver.handle(payload);
    return true;
  }

  has(target) { return this.receivers.has(target); }
  clear() { this.receivers.clear(); }
}

export default DisplayReceiverRegistry;
