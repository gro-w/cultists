/**
 * EventBus - a minimal publish/subscribe implementation used across the
 * engine as the backbone for decoupled, event-driven communication between
 * modules (KeywordManager, DayNightSystem, apps, etc).
 *
 * Usage:
 *   import { eventBus } from './EventBus.js';
 *   const unsubscribe = eventBus.on('keyword:collected', (payload) => {...});
 *   eventBus.emit('keyword:collected', { id: 'foo' });
 *   unsubscribe();
 */
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {(payload:any) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once.
   */
  once(event, handler) {
    const wrapped = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this._listeners.delete(event);
    }
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // copy to avoid mutation issues while iterating
    [...set].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for "${event}":`, err);
      }
    });
  }

  clear(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }
}

// Singleton instance shared across the whole application.
export const eventBus = new EventBus();
export default EventBus;
