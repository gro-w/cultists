// Phase 8 onboarding (新手引导) probe: proves the generic `OnboardingManager`
// milestone/hint mechanic (list/hasMilestone/markMilestone/dismissHint/
// acknowledgeHint/snapshot/restore) and the `markOnboardingMilestone`
// Activity node behave correctly, end-to-end through the real
// ActivityRunner exactly like every other generic node - nothing here
// references his/chatgtp/dorm content, only opaque hint ids, matching the
// same "engine primitive, not domain code" convention as KeywordManager.
import assert from "node:assert/strict";
import EventBus from "../core/EventBus.js";
import { VariableStore } from "../core/VariableStore.js";
import { ActivityDefinitionStore } from "../core/ActivityDefinitionStore.js";
import { ActivityQueueRegistry } from "../core/ActivityQueueRegistry.js";
import { ActivityExecutionService } from "../core/ActivityExecutionService.js";
import { validateBlueprint } from "../core/ActivityValidator.js";
import { OnboardingManager } from "../core/OnboardingManager.js";

const HINTS = [
  { id: "welcome", trigger: "desktop_seen", completeOn: "his_opened", target: ".desktop-icon", title: "欢迎", text: "先打开 HIS 系统吧！" },
  { id: "diagnose", trigger: "his_opened", completeOn: "first_diagnosis_submitted", target: ".his-submit", title: "问诊", text: "选好诊断和处方后提交。" },
];

function makeManager() {
  const eventBus = new EventBus();
  const onboardingManager = new OnboardingManager({ eventBus });
  onboardingManager.loadHints(HINTS);
  return { eventBus, onboardingManager };
}

// --- loadHints/list --------------------------------------------------------
{
  const { onboardingManager } = makeManager();
  assert.equal(onboardingManager.list().length, 2);
  assert.equal(onboardingManager.hasMilestone("desktop_seen"), false);
}

// --- markMilestone requests every hint whose `trigger` matches, once -------
{
  const { eventBus, onboardingManager } = makeManager();
  const requested = [];
  eventBus.on("onboarding:hint_requested", (hint) => requested.push(hint.id));
  onboardingManager.markMilestone("desktop_seen");
  assert.ok(onboardingManager.hasMilestone("desktop_seen"));
  assert.deepEqual(requested, ["welcome"]);

  // Marking the same milestone again is idempotent: no re-request, no
  // duplicate "onboarding:changed" (only the first mark is "new").
  let changedCount = 0;
  eventBus.on("onboarding:changed", () => { changedCount += 1; });
  onboardingManager.markMilestone("desktop_seen");
  assert.deepEqual(requested, ["welcome"]);
  assert.equal(changedCount, 0);
}

// --- marking `completeOn` auto-closes an already-shown, non-dismissed hint -
{
  const { eventBus, onboardingManager } = makeManager();
  const closed = [];
  eventBus.on("onboarding:hint_closed", ({ id }) => closed.push(id));
  onboardingManager.markMilestone("desktop_seen"); // shows "welcome"
  onboardingManager.markMilestone("his_opened"); // completes "welcome", triggers "diagnose"
  assert.deepEqual(closed, ["welcome"]);
}

// --- dismissHint prevents any future request/close for that hint id -------
{
  const { eventBus, onboardingManager } = makeManager();
  const requested = [];
  const closed = [];
  eventBus.on("onboarding:hint_requested", (hint) => requested.push(hint.id));
  eventBus.on("onboarding:hint_closed", ({ id }) => closed.push(id));
  onboardingManager.dismissHint("welcome");
  assert.deepEqual(closed, ["welcome"], "dismissHint immediately closes the hint even if it was never shown");
  onboardingManager.markMilestone("desktop_seen");
  assert.deepEqual(requested, [], "a dismissed hint's trigger milestone must not re-request it");
}

// --- acknowledgeHint just closes the current card, independent of state ---
{
  const { eventBus, onboardingManager } = makeManager();
  const closed = [];
  eventBus.on("onboarding:hint_closed", ({ id }) => closed.push(id));
  onboardingManager.acknowledgeHint("welcome");
  assert.deepEqual(closed, ["welcome"]);
}

// --- snapshot()/restore() round-trips milestones + shown/dismissed sets ----
{
  const { onboardingManager } = makeManager();
  onboardingManager.markMilestone("desktop_seen");
  onboardingManager.dismissHint("diagnose");
  const snapshot = onboardingManager.snapshot();
  assert.deepEqual(snapshot, {
    enabled: true,
    milestones: ["desktop_seen"],
    shownHintIds: ["welcome"],
    dismissedHintIds: ["diagnose"],
  });

  const restored = new OnboardingManager({ eventBus: new EventBus() });
  restored.loadHints(HINTS);
  restored.restore(snapshot);
  assert.ok(restored.hasMilestone("desktop_seen"));
  assert.deepEqual(restored.snapshot(), snapshot);

  // A missing/empty state restores to defaults rather than throwing.
  const fresh = new OnboardingManager({ eventBus: new EventBus() });
  fresh.restore();
  assert.deepEqual(fresh.snapshot(), { enabled: true, milestones: [], shownHintIds: [], dismissedHintIds: [] });
}

// --- setEnabled(false) suppresses hint requests/completions but still ------
// records the milestone itself (mirrors legacy's "关闭新手引导" toggle).
{
  const { eventBus, onboardingManager } = makeManager();
  onboardingManager.setEnabled(false);
  const requested = [];
  eventBus.on("onboarding:hint_requested", (hint) => requested.push(hint.id));
  onboardingManager.markMilestone("desktop_seen");
  assert.ok(onboardingManager.hasMilestone("desktop_seen"), "milestone tracking is unaffected by enabled flag");
  assert.deepEqual(requested, [], "no hint is requested while disabled");
}

// --- markOnboardingMilestone Activity node, exercised through the real -----
// ActivityRunner/ActivityExecutionService exactly like any other node.
{
  const eventBus = new EventBus();
  const variableStore = new VariableStore(eventBus);
  const onboardingManager = new OnboardingManager({ eventBus });
  onboardingManager.loadHints(HINTS);
  const activityDefinitionStore = new ActivityDefinitionStore();
  const definition = {
    id: "markMilestoneActivity",
    blueprint: {
      startNodeId: "start",
      nodes: {
        start: { id: "start", type: "flowStart", inputs: {} },
        mark: { id: "mark", type: "markOnboardingMilestone", inputs: { id: "desktop_seen" } },
        end: { id: "end", type: "activityEnd", inputs: {} },
      },
      connections: [
        { fromNodeId: "start", fromPort: "flowOut", toNodeId: "mark", toPort: "flowIn" },
        { fromNodeId: "mark", fromPort: "flowOut", toNodeId: "end", toPort: "flowIn" },
      ],
    },
  };
  const { ok, errors, blueprint } = validateBlueprint(definition.blueprint);
  assert.equal(ok, true, `blueprint should validate: ${errors?.join("；")}`);
  activityDefinitionStore.register({ id: definition.id, blueprint });
  const activityQueueRegistry = new ActivityQueueRegistry();
  const queue = activityQueueRegistry.get("main");
  const activityExecutionService = new ActivityExecutionService(eventBus);
  const instance = queue.append({ activityId: definition.id });

  // Without an onboardingGateway, the node must fail loudly rather than
  // silently no-op (same convention as dbGateway/pvGateway-requiring nodes).
  assert.throws(() => activityExecutionService.run({
    queue,
    definition: activityDefinitionStore.get(definition.id),
    instance,
    variableStore,
    timeGateway: () => {},
    windowGateway: () => {},
    activityGateway: () => {},
    eventGateway: () => {},
  }), /onboardingGateway/);

  const instance2 = queue.append({ activityId: definition.id });
  activityExecutionService.run({
    queue,
    definition: activityDefinitionStore.get(definition.id),
    instance: instance2,
    variableStore,
    timeGateway: () => {},
    windowGateway: () => {},
    activityGateway: () => {},
    eventGateway: () => {},
    onboardingGateway: onboardingManager,
  });
  assert.ok(onboardingManager.hasMilestone("desktop_seen"), "the node must call onboardingGateway.markMilestone with the resolved id");
}

console.log("onboarding-probe: all scenarios passed");
