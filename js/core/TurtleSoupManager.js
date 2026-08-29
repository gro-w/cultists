import { dataLoader } from "./DataLoader.js";
import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";
import { mainQueue, socialQueue } from "./ScheduleQueue.js";
import { specialEventManager } from "./SpecialEventManager.js";
import { cgManager } from "./CGManager.js";
import { favorabilityManager } from "./FavorabilityManager.js";

const ANSWERS = Object.freeze({ yes: "是", no: "不是", both: "是也不是" });

function normalize(text) {
  return String(text || "").trim().toLowerCase().replace(/[\s，。！？、,.!?]/g, "");
}

class TurtleSoupManager {
  constructor() {
    this.puzzles = new Map();
    this.state = { puzzleId: null, startDay: null, questionCount: 0, history: [], solved: false, solvedDay: null };
    this._loadPromise = null;
    this._mounted = false;
  }

  async load() {
    if (!this._loadPromise) {
      this._loadPromise = dataLoader.loadJSON("turtle_soups.json").then((data) => {
        this.puzzles = new Map((data.puzzles || []).map((puzzle) => [puzzle.id, puzzle]));
      });
    }
    return this._loadPromise;
  }

  mount() {
    if (this._mounted) return;
    this._mounted = true;
    eventBus.on("gamestate:changed", () => this._checkExpiry());
    eventBus.on("day:settled", () => this._checkExpiry());
  }

  getPuzzle(id = this.state.puzzleId) { return this.puzzles.get(id) || null; }

  startTurtleSoup(id) {
    const puzzle = this.getPuzzle(id);
    if (!puzzle) return { ok: false, reason: "unknownPuzzle" };
    if (this.state.puzzleId !== id || this.state.startDay == null) {
      this.state = { puzzleId: id, startDay: gameState.day, questionCount: 0, history: [], solved: false, solvedDay: null };
    } else this._resetForDay();
    eventBus.emit("turtle-soup:started", this.snapshot());
    return { ok: true, state: this.snapshot() };
  }

  _resetForDay() {
    const puzzle = this.getPuzzle();
    if (!puzzle || this.state.startDay == null) return;
    const progressDay = gameState.day - this.state.startDay + 1;
    const lastHistoryDay = this.state.history.at(-1)?.day;
    if (progressDay > 0 && lastHistoryDay !== gameState.day) this.state.questionCount = 0;
  }

  getProgress() {
    this._resetForDay();
    const puzzle = this.getPuzzle();
    return { ...this.snapshot(), puzzle, progressDay: this.state.startDay == null ? 0 : gameState.day - this.state.startDay + 1 };
  }

  ask(questionId) {
    const puzzle = this.getPuzzle();
    if (!puzzle || this.state.solved) return { ok: false, reason: "inactive" };
    this._resetForDay();
    if (this.state.history.some((entry) => entry.question_id === questionId)) return { ok: false, reason: "duplicate" };
    if (this.state.questionCount >= Number(puzzle.questions_per_day || 0)) return { ok: false, reason: "limit" };
    const question = puzzle.questions.find((entry) => entry.question_id === questionId);
    if (!question || !ANSWERS[question.answer]) return { ok: false, reason: "unknownQuestion" };
    const entry = { day: gameState.day, question_id: question.question_id, question_text: question.text, answer: question.answer };
    const instance = mainQueue.append([{ scheduleId: `turtle-soup:question:${this.state.puzzleId}:${gameState.day}:${questionId}`, payload: { type: "turtleSoupQuestion", questionId }, transcript: [] }])[0];
    mainQueue.complete(instance.instanceId);
    this.state.history.push(entry);
    this.state.questionCount += 1;
    eventBus.emit("turtle-soup:question-asked", { ...entry, instanceId: instance.instanceId });
    eventBus.emit("turtle-soup:question", entry);
    return { ok: true, answer: ANSWERS[question.answer], entry, state: this.snapshot() };
  }

  checkTurtleSoupGuess(input) {
    const puzzle = this.getPuzzle();
    if (!puzzle || this.state.solved) return false;
    const value = normalize(input);
    const accepted = (puzzle.accepted_guesses || []).some((guess) => normalize(guess) === value);
    const requiredKeywords = puzzle.required_keywords || [];
    const required = requiredKeywords.length > 0 && requiredKeywords.every((keyword) => value.includes(normalize(keyword)));
    const forbidden = (puzzle.forbidden_keywords || []).some((keyword) => value.includes(normalize(keyword)));
    return (accepted || required) && !forbidden;
  }

  guess(input) {
    const puzzle = this.getPuzzle();
    if (!puzzle || this.state.solved) return { ok: false, correct: false, reason: "inactive" };
    if (!this.checkTurtleSoupGuess(input)) {
      eventBus.emit("turtle-soup:guess-wrong", { input });
      eventBus.emit("turtle-soup:guessWrong", { input });
      return { ok: true, correct: false, message: puzzle.wrong_guess_message || "彬彬摇了摇头。" };
    }
    this.state.solved = true;
    this.state.solvedDay = gameState.day;
    const rewardNpcId = puzzle.reward_npc_id || puzzle.npcId || "binbin";
    const reward = Number(puzzle.reward_favorability ?? 15);
    if (reward > 0) favorabilityManager.modify(rewardNpcId, reward);
    if (puzzle.success_cg) cgManager.unlock(puzzle.success_cg);
    eventBus.emit("turtle-soup:guess-correct", this.snapshot());
    eventBus.emit("turtle-soup:guessCorrect", this.snapshot());
    if (puzzle.success_event) {
      this._queueEvent(puzzle.success_event);
      eventBus.emit(`event:${puzzle.success_event}`, { puzzleId: puzzle.id });
    }
    return { ok: true, correct: true, message: puzzle.success_message || "你猜中了汤底。" };
  }

  finishDay() {
    eventBus.emit("turtle-soup:day-finished", this.snapshot());
    eventBus.emit("turtle-soup:dayFinished", this.snapshot());
    return this.getProgress();
  }

  _checkExpiry() {
    const puzzle = this.getPuzzle();
    if (!puzzle || this.state.solved || this.state.startDay == null) return;
    if (gameState.day > this.state.startDay + Number(puzzle.max_days || 7) - 1) {
      this.state.solved = true;
      this._queueEvent(puzzle.fail_event);
      eventBus.emit("turtle-soup:failed", { puzzleId: puzzle.id, day: gameState.day });
      eventBus.emit(`event:${puzzle.fail_event}`, { puzzleId: puzzle.id });
    }
  }

  _queueEvent(eventId) {
    const definition = specialEventManager.events.find((event) => event.id === eventId);
    if (!definition || socialQueue.getPending().some((entry) => entry.scheduleId === eventId)) return;
    socialQueue.append([{ ...definition, scheduleId: eventId, receivedDay: gameState.day, receivedTime: gameState.clockMinutes }]);
  }

  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  restore(state = {}) { this.state = { ...this.state, ...state, history: Array.isArray(state.history) ? state.history : [] }; }
}

export const turtleSoupManager = new TurtleSoupManager();
export const turtleSoupAnswers = ANSWERS;
export default TurtleSoupManager;
