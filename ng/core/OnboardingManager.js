/**
 * OnboardingManager - the generic "milestone-driven tutorial hint"
 * mechanic. Mirrors the legacy `js/core/OnboardingManager.js`'s *effect*
 * (a milestone Set drives which hints get shown, once each) but is fully
 * data-driven rather than hardcoded JS: legacy hardcodes both the
 * milestone id list and a JS object mapping specific eventBus event names
 * to milestone ids; here *any* milestone id is just an opaque string any
 * Activity blueprint can mark via the generic `markOnboardingMilestone`
 * node (dialogue node/widget onClick/window onCreate/desktop icon - no
 * engine code change needed to add a new milestone), and the hint list
 * itself is authored content (`data/onboarding.json`) editable through a
 * dev-tool visual editor, not a source-code constant.
 *
 * A hint `{id, trigger, completeOn, target, title, text}`
 * is requested (shown) the moment `trigger` is first marked, and
 * is auto-dismissed the moment `completeOn` is marked (if set) -
 * same two-milestone shape as legacy's `HINTS` entries. Each hint is shown
 * at most once per save unless explicitly reset.
 */
export class OnboardingManager {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus;
    /** @type {Map<string, object>} hintId -> hint definition */
    this.hints = new Map();
    /** @type {Set<string>} every milestone id ever marked */
    this.milestones = new Set();
    /** @type {Set<string>} hint ids already shown at least once */
    this.shownHintIds = new Set();
    /** @type {Set<string>} hint ids the player dismissed ("以后不再提示") */
    this.dismissedHintIds = new Set();
    this.enabled = true;
  }

  /** Loads the authored hint list (replacing any previous content); does not touch milestone/shown/dismissed progress. */
  loadHints(hints = []) {
    this.hints = new Map();
    (Array.isArray(hints) ? hints : []).forEach((hint) => {
      if (hint && typeof hint.id === "string") this.hints.set(hint.id, hint);
    });
  }

  list() {
    return [...this.hints.values()];
  }

  hasMilestone(id) {
    return this.milestones.has(id);
  }

  /** Marks a milestone (idempotent besides hint side-effects). Requests every hint whose `trigger` matches, and auto-dismisses every shown-but-not-dismissed hint whose `completeOn` matches. */
  markMilestone(id) {
    if (!id) return;
    const isNew = !this.milestones.has(id);
    this.milestones.add(id);
    if (isNew) this.eventBus?.emit("onboarding:changed", this.snapshot());
    if (!this.enabled) return;
    this.hints.forEach((hint) => {
      if (hint.completeOn === id && this.shownHintIds.has(hint.id) && !this.dismissedHintIds.has(hint.id)) {
        this._closeHint(hint.id);
      }
    });
    if (isNew) {
      this.hints.forEach((hint) => {
        if (hint.trigger === id) this._requestHint(hint.id);
      });
    }
  }

  _requestHint(hintId) {
    const hint = this.hints.get(hintId);
    if (!hint || this.shownHintIds.has(hintId) || this.dismissedHintIds.has(hintId)) return;
    this.shownHintIds.add(hintId);
    this.eventBus?.emit("onboarding:hint_requested", { ...hint });
  }

  _closeHint(hintId) {
    this.eventBus?.emit("onboarding:hint_closed", { id: hintId });
  }

  /** Player explicitly dismissed a hint ("以后不再提示"): never shown again this save. */
  dismissHint(hintId) {
    if (!this.hints.has(hintId)) return;
    this.dismissedHintIds.add(hintId);
    this._closeHint(hintId);
    this.eventBus?.emit("onboarding:changed", this.snapshot());
  }

  /** Player acknowledged a hint ("知道了"): closes it now, without preventing a later re-show if its trigger milestone is marked again after a `reset()`. */
  acknowledgeHint(hintId) {
    this._closeHint(hintId);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.eventBus?.emit("onboarding:changed", this.snapshot());
  }

  snapshot() {
    return {
      enabled: this.enabled,
      milestones: [...this.milestones],
      shownHintIds: [...this.shownHintIds],
      dismissedHintIds: [...this.dismissedHintIds],
    };
  }

  restore(state = {}) {
    this.enabled = state.enabled !== false;
    this.milestones = new Set(Array.isArray(state.milestones) ? state.milestones : []);
    this.shownHintIds = new Set(Array.isArray(state.shownHintIds) ? state.shownHintIds : []);
    this.dismissedHintIds = new Set(Array.isArray(state.dismissedHintIds) ? state.dismissedHintIds : []);
  }
}

export default OnboardingManager;
