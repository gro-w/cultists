import { eventBus } from "./EventBus.js";
import { dataLoader } from "./DataLoader.js";
import { gameState } from "./GameState.js";

const DEFAULT_LIMITS = { dialogueLimit: Infinity, inspectLimit: Infinity };

/**
 * ActionBudget - singleton tracking how many "actions" (NPC dialogue turns,
 * item inspections) the player has spent in the current day/night phase,
 * and applying the configured consequence once a phase ends over budget:
 *   - overspending during the DAY is banked as overtime debt that shrinks
 *     the *upcoming night's* budget (加班侵占夜间时间);
 *   - overspending at NIGHT directly costs 精神 (SAN) once the night ends
 *     (熬夜熬过头掉 san).
 * Limits are data-driven via `data/action_budget.json`.
 *
 * Wiring: `recordDialogueTurn()`/`recordInspection()` are driven by the
 * `dialogue:turn` (emitted by HIS/Social/Monitor when the player picks a
 * dialogue option) and `item:inspected` (emitted by ItemManager.inspect())
 * events, so this module stays decoupled from the apps/managers that
 * generate those actions - same one-way event-bus pattern EndingManager
 * uses for `item:used`.
 *
 * Not yet persisted by SaveManager (phase 1 of this feature) - a loaded
 * save starts the current phase with a fresh budget and no carried debt.
 */
class ActionBudget {
  constructor() {
    this.config = null;
    this.used = { dialogue: 0, inspect: 0 };
    this.currentLimits = { ...DEFAULT_LIMITS };
    this._pendingNightDebt = 0;
    this._initPromise = null;

    eventBus.on("item:inspected", () => this.recordInspection());
    eventBus.on("dialogue:turn", () => this.recordDialogueTurn());
    // DayNightSystem.toggle() settles the ending phase's overage and then
    // emits this same event with the new phase - listening here (rather
    // than DayNightSystem calling startPhase directly) means GameState's
    // own daynight:changed emission (e.g. from SaveManager restoring a
    // save) also correctly resets the budget for whatever phase was
    // loaded, with a single code path.
    eventBus.on("daynight:changed", ({ phase }) => this.startPhase(phase));
  }

  /**
   * Load `data/action_budget.json` (idempotent, safe to call concurrently)
   * and activate the CURRENT phase's limits immediately - `startPhase()`
   * is otherwise only driven by the `daynight:changed` event, which does
   * not fire at boot, so without this the very first day/night would sit
   * at the Infinity default until the first phase toggle.
   */
  async init() {
    if (!this._initPromise) {
      this._initPromise = dataLoader.loadJSON("action_budget.json").then((data) => {
        this.config = data;
        this.startPhase(gameState.phase);
      });
    }
    return this._initPromise;
  }

  /**
   * Activate the limits for `phase`, applying any overtime debt carried
   * over from the day that just ended (only relevant when phase="night")
   * and resetting the used-action counters for the new phase.
   */
  startPhase(phase) {
    const base = (this.config && this.config[phase]) || DEFAULT_LIMITS;
    let dialogueLimit = base.dialogueLimit ?? Infinity;
    let inspectLimit = base.inspectLimit ?? Infinity;

    if (phase === "night" && this._pendingNightDebt > 0) {
      let debt = this._pendingNightDebt;
      const dialogueCut = Math.min(dialogueLimit, debt);
      dialogueLimit -= dialogueCut;
      debt -= dialogueCut;
      const inspectCut = Math.min(inspectLimit, debt);
      inspectLimit -= inspectCut;
      this._pendingNightDebt = 0;
    }

    this.currentLimits = { dialogueLimit, inspectLimit };
    this.used = { dialogue: 0, inspect: 0 };
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Tally the (about-to-end) `phase`'s overage against its limits and
   * apply the matching consequence.
   * @returns {{ totalOverage: number, kind: "overtime"|"allnighter"|null, debt?: number, sanLoss?: number }}
   */
  settlePhase(phase) {
    const overageDialogue = Math.max(0, this.used.dialogue - this.currentLimits.dialogueLimit);
    const overageInspect = Math.max(0, this.used.inspect - this.currentLimits.inspectLimit);
    const totalOverage = overageDialogue + overageInspect;
    if (totalOverage <= 0) return { totalOverage: 0, kind: null };

    const perAction = (this.config && this.config.overtimePenaltyPerAction) || 1;
    if (phase === "day") {
      this._pendingNightDebt += totalOverage * perAction;
      return { totalOverage, kind: "overtime", debt: this._pendingNightDebt };
    }

    const sanLossPerAction = (this.config && this.config.sanLossPerLateNightAction) || 0;
    const sanLoss = totalOverage * sanLossPerAction;
    if (sanLoss > 0) gameState.modify({ mental: -sanLoss });
    return { totalOverage, kind: "allnighter", sanLoss };
  }

  recordDialogueTurn() {
    this.used.dialogue += 1;
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  recordInspection() {
    this.used.inspect += 1;
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /**
   * Permanently shrink the CURRENT phase's remaining budget (used by
   * NpcStateManager's offline consequence: an NPC going offline dumps
   * their workload on the protagonist for the rest of this phase).
   * Cannot raise a limit, only lower it, and never below what's already
   * been used (so it shows up immediately as "over budget" rather than
   * silently vanishing).
   * @param {{dialogueLimit?: number, inspectLimit?: number}} penalty
   */
  applyPenalty(penalty = {}) {
    if (typeof penalty.dialogueLimit === "number" && Number.isFinite(this.currentLimits.dialogueLimit)) {
      this.currentLimits.dialogueLimit = Math.max(
        this.used.dialogue,
        this.currentLimits.dialogueLimit - penalty.dialogueLimit
      );
    }
    if (typeof penalty.inspectLimit === "number" && Number.isFinite(this.currentLimits.inspectLimit)) {
      this.currentLimits.inspectLimit = Math.max(
        this.used.inspect,
        this.currentLimits.inspectLimit - penalty.inspectLimit
      );
    }
    eventBus.emit("actionBudget:changed", this.snapshot());
  }

  /** Actions still available this phase for `kind` ("dialogue"|"inspect"); may be negative once over budget. */
  remaining(kind) {
    const limitKey = kind === "inspect" ? "inspectLimit" : "dialogueLimit";
    const usedKey = kind === "inspect" ? "inspect" : "dialogue";
    return this.currentLimits[limitKey] - this.used[usedKey];
  }

  snapshot() {
    return {
      used: { ...this.used },
      limits: { ...this.currentLimits },
      pendingNightDebt: this._pendingNightDebt,
    };
  }

  /** Subscribe to any change in used actions / limits. Returns an unsubscribe function. */
  onChange(handler) {
    return eventBus.on("actionBudget:changed", handler);
  }
}

export const actionBudget = new ActionBudget();
export default ActionBudget;
