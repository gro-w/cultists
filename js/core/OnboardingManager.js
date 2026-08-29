import { eventBus } from "./EventBus.js";


export const ONBOARDING_MILESTONES = [
  "desktop_seen", "his_opened", "first_patient_selected", "first_dialogue_seen", "first_dialogue_choice",
  "first_keyword_collected", "notebook_opened", "chatgtp_opened", "first_query_completed",
  "first_diagnosis_submitted", "workday_completed", "dorm_seen", "first_social_interaction",
  "sleep_explained",
];

const HINTS = [
  { id: "welcome", trigger: "desktop_seen", completeOn: "his_opened", target: ".desktop-icon[data-app-id=\"his\"]", title: "欢迎！新的实习生~", text: "请先打开 HIS 系统吧！" },
  { id: "his-first-open", trigger: "his_opened", completeOn: "first_patient_selected", target: ".his-patient-btn", title: "第一次问诊", text: "点击病人查看对话，收集症状，最后提交诊断与处方。" },
  { id: "dialogue-questions", trigger: "first_dialogue_seen", completeOn: "first_dialogue_choice", target: ".dialogue-options", title: "选择询问方式", text: "请选择下面三个问题中的一个继续问诊。不同的问题，可能会带来不同的线索。" },
  { id: "keyword-first", trigger: "his:keyword_available", completeOn: "first_keyword_collected", target: ".keyword-highlight", title: "收集关键词", text: "看到对话中的高亮关键词了吗？点击这些关键词，把它们收集到你的笔记本里吧！" },
  { id: "keyword-missed", trigger: "his:keyword_missed", target: ".keyword-highlight", title: "错过的关键词", text: "时间不等人啊~错过的关键词是找不回来的呢~" },
  { id: "chatgtp-suggestion", trigger: "his:diagnosis_picker_opened", completeOn: "chatgtp_opened", target: ".desktop-icon[data-app-id=\"chatgtp\"]", title: "需要一点帮助？", text: "不知道该选什么诊断用什么药？要不要试试问问万能的ChatGTP？" },
  { id: "notebook-first-open", trigger: "notebook_opened", completeOn: "first_query_completed", target: ".app-notebook", title: "关键词笔记本", text: "笔记本会保存你收集到的关键词。双击关键词，可以直接交给 ChatGTP 查询。" },
  { id: "chatgtp-first-open", trigger: "chatgtp_opened", completeOn: "first_query_completed", target: ".chatgtp-notebook-select", title: "ChatGTP", text: "ChatGTP 可以根据 1～2 个关键词进行分析。查询会消耗时间，也会影响它自己的 SAN。" },
  { id: "diagnosis-submit", trigger: "his:diagnosis_ready", completeOn: "first_diagnosis_submitted", target: ".his-prescription", title: "提交问诊", text: "提交后会结算本次问诊，并推进 20 分钟。提交前请确认诊断和处方。" },
  { id: "dorm-first-seen", trigger: "dorm_seen", completeOn: "first_social_interaction", target: ".dorm-npc-strip", title: "宿舍", text: "夜间可以和室友交流、调查物品、使用电脑。准备结束今天时，可以点击床铺睡觉。" },
  { id: "sleep-first", trigger: "dorm:about_to_sleep", completeOn: "sleep_explained", target: ".dorm-bed-confirm-ok", title: "结束今天", text: "睡觉会进入下一天，并结算休息、收入和其他跨日效果。" },
];

class OnboardingManager {
  constructor(bus = eventBus) {
    this.bus = bus;
    this.enabled = true;
    this.mode = "assist";
    this.milestones = new Set();
    this.dismissedHintIds = new Set();
    this.shownHintIds = new Set();
    this.activeHintId = null;
    this.currentRecommendedGoal = "打开 HIS";
    this._unsubs = [];
    this._started = false;
  }

  init() {
    if (this._started) return this;
    this._started = true;
    const map = {
      "window:opened": ({ appId }) => ({ his: "his_opened", notebook: "notebook_opened", chatgtp: "chatgtp_opened" }[appId]),
      "keyword:collected": () => "first_keyword_collected",
      "medical:submitted": () => "first_diagnosis_submitted",
      "chatgtp:query_completed": () => "first_query_completed",
      "his:patient_selected": () => "first_patient_selected",
      "his:dialogue_seen": () => "first_dialogue_seen",
      "his:dialogue_choice_selected": () => "first_dialogue_choice",
      "dorm:interaction": () => "first_social_interaction",
      "dorm:sleep_completed": () => "sleep_explained",
    };
    Object.entries(map).forEach(([event, resolve]) => {
      this._unsubs.push(this.bus.on(event, (payload) => {
        const id = resolve(payload);
        if (id) this.markMilestone(id);
      }));
    });
    this._unsubs.push(this.bus.on("his:diagnosis_ready", () => this.requestHint("his:diagnosis_ready")));
    this._unsubs.push(this.bus.on("his:diagnosis_picker_opened", () => this.requestHint("his:diagnosis_picker_opened")));
    this._unsubs.push(this.bus.on("dorm:about_to_sleep", () => this.requestHint("dorm:about_to_sleep")));
    this._unsubs.push(this.bus.on("his:keyword_available", () => this.requestHint("his:keyword_available")));
    this._unsubs.push(this.bus.on("his:keyword_missed", () => this.requestHint("his:keyword_missed")));
    this._unsubs.push(this.bus.on("daynight:changed", ({ location, phaseChanged }) => {
      if (location === "dorm") this.markMilestone("dorm_seen");
      if (phaseChanged && location === "dorm") this.markMilestone("workday_completed");
    }));
    return this;
  }

  destroy() {
    this._unsubs.forEach((off) => off());
    this._unsubs = [];
    this._started = false;
  }

  startNewGame() {
    this.resetForNewGame();
    this.markMilestone("desktop_seen");
  }

  resetForNewGame() {
    this.milestones.clear();
    this.dismissedHintIds.clear();
    this.shownHintIds.clear();
    this.activeHintId = null;
    this._updateGoal();
  }

  markMilestone(id) {
    if (!ONBOARDING_MILESTONES.includes(id) || this.milestones.has(id)) return false;
    this.milestones.add(id);
    this._updateGoal();
    this.bus.emit("onboarding:changed", this.snapshot());
    const hint = HINTS.find((entry) => entry.trigger === id);
    if (hint) this.requestHint(hint.trigger);
    return true;
  }

  hasMilestone(id) { return this.milestones.has(id); }
  requestHint(trigger) {
    const hint = HINTS.find((entry) => entry.trigger === trigger);
    if (!hint || !this.enabled || this.dismissedHintIds.has(hint.id) || this.shownHintIds.has(hint.id)) return false;
    this.shownHintIds.add(hint.id);
    this.activeHintId = hint.id;
    this.bus.emit("onboarding:hint_requested", { ...hint });
    return true;
  }
  dismissHint(id) {
    this.dismissedHintIds.add(id);
    if (this.activeHintId === id) this.activeHintId = null;
    this.bus.emit("onboarding:changed", this.snapshot());
  }

  _updateGoal() {
    const goals = [
      ["his_opened", "打开 HIS"], ["first_keyword_collected", "在对话中收集关键词"],
      ["notebook_opened", "查看关键词笔记本"], ["first_query_completed", "用关键词查询 ChatGTP"],
      ["first_diagnosis_submitted", "完成首例问诊"], ["dorm_seen", "下班后回宿舍"],
      ["sleep_explained", "结束今天并睡觉"],
    ];
    this.currentRecommendedGoal = goals.find(([id]) => !this.hasMilestone(id))?.[1] || "自由探索";
  }

  recommendedGoal() { return this.currentRecommendedGoal; }
  snapshot() {
    return { enabled: this.enabled, mode: this.mode, milestones: [...this.milestones], dismissedHintIds: [...this.dismissedHintIds], shownHintIds: [...this.shownHintIds] };
  }
  restore(data = {}) {
    this.enabled = data.enabled !== false;
    this.mode = data.mode === "minimal" ? "minimal" : "assist";
    this.milestones = new Set((data.milestones || []).filter((id) => ONBOARDING_MILESTONES.includes(id)));
    this.dismissedHintIds = new Set(data.dismissedHintIds || []);
    this.shownHintIds = new Set(data.shownHintIds || []);
    this.activeHintId = null;
    this._updateGoal();
  }
}

export const onboardingManager = new OnboardingManager();
export default OnboardingManager;