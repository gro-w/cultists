import assert from "node:assert/strict";
import OnboardingManager from "../js/core/OnboardingManager.js";

class ProbeBus {
  constructor() { this.listeners = new Map(); this.events = []; }
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    return () => this.listeners.get(name)?.delete(handler);
  }
  emit(name, payload) {
    this.events.push({ name, payload });
    [...(this.listeners.get(name) || [])].forEach((handler) => handler(payload));
  }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

const bus = new ProbeBus();
const onboarding = new OnboardingManager(bus);
onboarding.init();
assert.equal(bus.count(), 14, "init registers mapped event listeners plus day/night and contextual hints");
onboarding.startNewGame();
assert.deepEqual(onboarding.snapshot().milestones, ["desktop_seen"]);
assert.equal(onboarding.recommendedGoal(), "打开 HIS");
const hintsBefore = bus.events.filter(({ name }) => name === "onboarding:hint_requested").length;
assert.equal(onboarding.markMilestone("his_opened"), true);
assert.equal(onboarding.markMilestone("his_opened"), false);
assert.equal(bus.events.filter(({ name }) => name === "onboarding:hint_requested").length, hintsBefore + 1);
assert.equal(onboarding.requestHint("his:diagnosis_ready"), true);
assert.equal(onboarding.requestHint("his:diagnosis_ready"), false);
assert.equal(onboarding.requestHint("his:diagnosis_picker_opened"), true);
assert.equal(onboarding.requestHint("his:diagnosis_picker_opened"), false);
assert.equal(onboarding.requestHint("his:keyword_available"), true);
assert.equal(onboarding.requestHint("his:keyword_available"), false);
assert.equal(onboarding.requestHint("his:keyword_missed"), true);
assert.equal(onboarding.requestHint("his:keyword_missed"), false);

bus.emit("keyword:collected", { keyword: { id: "symptom" } });
assert.equal(onboarding.hasMilestone("first_keyword_collected"), true);
assert.equal(onboarding.hasMilestone("first_query_completed"), false);
assert.equal(onboarding.recommendedGoal(), "查看关键词笔记本");
bus.emit("window:opened", { appId: "notebook" });
assert.equal(onboarding.recommendedGoal(), "用关键词查询 ChatGTP");
assert.equal(onboarding.hasMilestone("first_diagnosis_submitted"), false, "a failed submission emits no success event");
bus.emit("medical:submitted", { ok: true });
assert.equal(onboarding.hasMilestone("first_diagnosis_submitted"), true, "only the business success event is authoritative");

const saved = onboarding.snapshot();
const restored = new OnboardingManager(new ProbeBus());
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
assert.equal(restored.snapshot().activeHintId, undefined);
onboarding.destroy();
assert.equal(bus.count(), 0, "destroy removes every subscription");
console.log("onboarding probe: ok");