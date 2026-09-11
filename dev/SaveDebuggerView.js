// DEV-TOOLS:START
/** Visual runtime-save debugger. It never edits or writes canonical game JSON. */
export class SaveDebuggerView {
  constructor({ saveManager } = {}) {
    this.saveManager = saveManager;
    this.el = document.createElement("div");
    this.el.className = "ng-dev-save-debugger";
    this.el.innerHTML = `
      <div class="ng-dev-toolbar">
        <button type="button" data-action="read">读取当前运行时</button>
        <button type="button" data-action="apply">应用修改</button>
      </div>
      <p class="ng-dev-help">这里只修改存档中的运行时状态。日历列表、成就列表、数据库记录和其他游戏 JSON 不属于存档。</p>
      <div class="ng-save-debugger-fields" data-role="fields"></div>
      <output data-role="status"></output>
    `;
    this.fieldsEl = this.el.querySelector('[data-role="fields"]');
    this.statusEl = this.el.querySelector('[data-role="status"]');
    this.el.querySelector('[data-action="read"]').addEventListener("click", () => this.read());
    this.el.querySelector('[data-action="apply"]').addEventListener("click", () => this.apply());
    this.read();
  }

  _field(label, value, path, type = "text") {
    const row = document.createElement("label");
    row.className = "ng-save-debugger-field";
    row.textContent = label;
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.type = type === "textarea" ? undefined : type;
    input.value = type === "checkbox" ? "" : (typeof value === "string" ? value : String(value ?? ""));
    if (type === "checkbox") input.checked = Boolean(value);
    input.dataset.path = path;
    input.dataset.valueType = type;
    if (type === "textarea") input.spellcheck = false;
    row.append(input);
    return row;
  }

  _section(title) {
    const section = document.createElement("fieldset");
    section.className = "ng-save-debugger-section";
    const legend = document.createElement("legend");
    legend.textContent = title;
    section.append(legend);
    return section;
  }

  read() {
    try {
      const envelope = this.saveManager.snapshot();
      const state = envelope.state;
      this.fieldsEl.replaceChildren();

      const clock = this._section("游戏时间");
      clock.append(this._field("日期", state.gameClock.day, "gameClock.day", "number"));
      clock.append(this._field("分钟", state.gameClock.minutes, "gameClock.minutes", "number"));
      this.fieldsEl.append(clock);

      const gameState = this._section("游戏运行状态");
      for (const key of ["day", "phase", "duty", "location", "energy", "mental", "physical", "satiety"]) {
        const value = state.gameState[key];
        gameState.append(this._field(key, value, `gameState.${key}`, typeof value === "number" ? "number" : "text"));
      }
      this.fieldsEl.append(gameState);

      const variables = this._section("活动变量（不含派生 UI 数据）");
      for (const [key, value] of Object.entries(state.variables)) {
        const type = typeof value === "boolean" ? "checkbox" : (typeof value === "number" ? "number" : (value && typeof value === "object" ? "textarea" : "text"));
        const display = type === "textarea" ? JSON.stringify(value, null, 2) : value;
        variables.append(this._field(key, display, `variables.${key}`, type));
      }
      if (!Object.keys(state.variables).length) variables.append(document.createTextNode("无可保存的活动变量"));
      this.fieldsEl.append(variables);

      const publicVariables = this._section("公共变量");
      const definitions = new Map(this.saveManager.publicVariableManager?.list().map((item) => [String(item.id), item]) || []);
      for (const [id, value] of Object.entries(state.publicVariables)) {
        const definition = definitions.get(id);
        const label = definition ? `${definition.name} (#${id})` : `变量 #${id}`;
        const type = typeof value === "boolean" ? "checkbox" : (typeof value === "number" ? "number" : (value && typeof value === "object" ? "textarea" : "text"));
        const display = type === "textarea" ? JSON.stringify(value, null, 2) : value;
        publicVariables.append(this._field(label, display, `publicVariables.${id}`, type));
      }
      this.fieldsEl.append(publicVariables);

      const summary = this._section("由系统恢复的运行时结构");
      summary.append(document.createTextNode(`活动队列：${Object.keys(state.queues || {}).length} 个；窗口：${(state.windows || []).length} 个；运行时存储：${Object.keys(state.runtime || {}).length} 个`));
      this.fieldsEl.append(summary);
      this.statusEl.textContent = "已读取运行时状态";
    } catch (error) {
      this.statusEl.textContent = `读取失败: ${error.message}`;
    }
  }

  _readValue(input) {
    const type = input.dataset.valueType;
    if (type === "checkbox") return input.checked;
    if (type === "number") return Number(input.value);
    if (type === "textarea") return JSON.parse(input.value);
    return input.value;
  }

  apply() {
    try {
      const envelope = this.saveManager.snapshot();
      for (const input of this.fieldsEl.querySelectorAll("[data-path]")) {
        const separator = input.dataset.path.indexOf(".");
        const group = input.dataset.path.slice(0, separator);
        const key = input.dataset.path.slice(separator + 1);
        const value = this._readValue(input);
        if (group === "gameClock" || group === "gameState") envelope.state[group][key] = value;
        else if (group === "variables") envelope.state.variables[key] = value;
        else if (group === "publicVariables") envelope.state.publicVariables[key] = value;
      }
      this.saveManager.restore(envelope);
      this.statusEl.textContent = "已应用运行时修改；未写入数据库或游戏 JSON";
      this.read();
    } catch (error) {
      this.statusEl.textContent = `应用失败，当前状态未改变: ${error.message}`;
    }
  }
}

export default SaveDebuggerView;
// DEV-TOOLS:END
