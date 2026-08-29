// DEV-TOOLS:START
import { dataLoader } from "../core/DataLoader.js";
import { turtleSoupManager } from "../core/TurtleSoupManager.js";

export class DevTurtleSoupEditorTab {
  constructor(dev) { this._dev = dev; this._doc = { puzzles: [] }; this._root = null; }
  html() { return `<div class="dev-turtle-root"><h3>🐢 海龟汤谜题编辑器</h3><p>答案只能是“是 / 不是 / 是也不是”。保存前会校验问题池。</p><textarea data-turtle-json class="dev-textarea" style="min-height:420px;width:100%"></textarea><div><button type="button" class="win95-btn dev-btn" data-turtle-save>保存到内存</button><button type="button" class="win95-btn dev-btn" data-turtle-download>下载 JSON</button><button type="button" class="win95-btn dev-btn" data-turtle-write>写入磁盘</button></div><p data-turtle-status></p></div>`; }
  async mount(root) {
    this._root = root;
    try { this._doc = await dataLoader.loadJSON("turtle_soups.json"); } catch (_) { this._doc = { puzzles: [] }; }
    root.querySelector("[data-turtle-json]").value = JSON.stringify(this._doc, null, 2);
    root.querySelector("[data-turtle-save]").addEventListener("click", () => this._save(false));
    root.querySelector("[data-turtle-download]").addEventListener("click", () => { if (this._save(false)) this._dev.downloadFile("turtle_soups.json", this._doc); });
    root.querySelector("[data-turtle-write]").addEventListener("click", async () => { if (this._save(false)) await this._dev.writeToDisk("turtle_soups.json", this._doc); });
  }
  _save(showStatus = true) {
    try {
      const doc = JSON.parse(this._root.querySelector("[data-turtle-json]").value);
      if (!Array.isArray(doc.puzzles)) throw new Error("puzzles 必须是数组");
      const ids = new Set();
      doc.puzzles.forEach((puzzle) => {
        if (!puzzle.id || ids.has(puzzle.id)) throw new Error("谜题 ID 缺失或重复");
        ids.add(puzzle.id);
        (puzzle.questions || []).forEach((question) => {
          if (!["yes", "no", "both"].includes(question.answer)) throw new Error(`问题 ${question.question_id} 的答案非法`);
        });
      });
      this._doc = doc;
      turtleSoupManager.puzzles = new Map(doc.puzzles.map((puzzle) => [puzzle.id, puzzle]));
      if (showStatus) this._root.querySelector("[data-turtle-status]").textContent = "已保存到内存。";
      return true;
    } catch (error) { this._root.querySelector("[data-turtle-status]").textContent = `保存失败：${error.message}`; return false; }
  }
  unmount() { this._root = null; }
}
// DEV-TOOLS:END
