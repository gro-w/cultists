import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { WindowManager } from "../core/WindowManager.js";
import { PointerInteraction } from "../desktop/PointerInteraction.js";

/** Minimal fake `window`-like target so PointerInteraction can be probed headlessly. */
class FakeTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(name, handler) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(handler);
  }
  removeEventListener(name, handler) {
    this._listeners.get(name)?.delete(handler);
  }
  listenerCount() {
    let count = 0;
    for (const set of this._listeners.values()) count += set.size;
    return count;
  }
  fire(name, payload) {
    for (const handler of [...(this._listeners.get(name) || [])]) handler(payload);
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

// --- Two windows: focus and z-index -----------------------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const a = wm.open({ windowId: "a", title: "A", x: 10, y: 10, width: 300, height: 200 });
  const b = wm.open({ windowId: "b", title: "B", x: 40, y: 40, width: 300, height: 200 });
  assert.ok(b.zIndex > a.zIndex, "second window opened is on top");
  assert.equal(wm.focusedInstanceId(), b.instanceId);
  wm.focus(a.instanceId);
  const refreshedA = wm.get(a.instanceId);
  assert.ok(refreshedA.zIndex > wm.get(b.instanceId).zIndex, "focusing A raises it above B");
  assert.equal(wm.focusedInstanceId(), a.instanceId);
}

// --- Drag ends exactly at the pointer end position --------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const state = wm.open({ windowId: "drag-test", x: 100, y: 80, width: 300, height: 200 });
  const originX = state.x;
  const originY = state.y;
  const startX = 500;
  const startY = 300;
  const drag = new PointerInteraction(new FakeTarget());
  drag.start({
    onMove: (event) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      wm.moveTo(state.instanceId, originX + dx, originY + dy);
    },
  });
  drag.target.fire("pointermove", { clientX: 560, clientY: 340 });
  const moved = wm.get(state.instanceId);
  assert.equal(moved.x, originX + 60, "x equals pointer end position");
  assert.equal(moved.y, originY + 40, "y equals pointer end position");
  drag.cancel();
}

// --- Resize clamps to the documented minimums --------------------------------
{
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage: memoryStorage() });
  const state = wm.open({ windowId: "resize-test", width: 300, height: 200 });
  wm.resize(state.instanceId, 10, 10);
  const resized = wm.get(state.instanceId);
  assert.equal(resized.width, WindowManager.MIN_WIDTH);
  assert.equal(resized.height, WindowManager.MIN_HEIGHT);
}

// --- Close/restore: pointer interaction leaks no listeners -------------------
{
  const target = new FakeTarget();
  const drag = new PointerInteraction(target);
  drag.start({ onMove: () => {} });
  assert.equal(target.listenerCount(), 2, "pointermove + pointerup registered while dragging");
  // Simulate the window closing mid-drag (WindowFrame.dispose() calls cancel()).
  drag.cancel();
  assert.equal(target.listenerCount(), 0, "cancel() removes every listener even without pointerup");

  drag.start({ onMove: () => {} });
  target.fire("pointerup", {});
  assert.equal(target.listenerCount(), 0, "a normal pointerup also leaves no listeners behind");
}

// --- EventBus subscriptions used by WindowFrame don't leak either -----------
{
  const bus = new EventBus();
  const unsubscribe = bus.on("window:focused", () => {});
  assert.equal(bus.listenerCount(), 1);
  unsubscribe();
  assert.equal(bus.listenerCount(), 0, "unsubscribing on close leaves no dangling handlers");
}

// --- x/y = 0 must still be saved and restored (no falsy-coalescing bugs) ----
{
  const storage = memoryStorage();
  const bus = new EventBus();
  const wm = new WindowManager(bus, { storage });
  const state = wm.open({ windowId: "zero-test", x: 0, y: 0, width: 300, height: 200 });
  assert.equal(state.x, 0);
  assert.equal(state.y, 0);
  wm.persistGeometry(state.instanceId);

  // A fresh manager reading the same storage must recover the exact 0/0 geometry.
  const wm2 = new WindowManager(new EventBus(), { storage });
  const saved = wm2.getSavedGeometry("zero-test");
  assert.equal(saved.x, 0, "x=0 survives persistence");
  assert.equal(saved.y, 0, "y=0 survives persistence");
}

console.log("ng window-manager probe: ok");
