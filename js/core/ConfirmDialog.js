import { windowManager } from "./WindowManager.js";

/**
 * ConfirmDialog - a small Win95-styled modal window offering 确认/取消
 * buttons, used in place of the native `window.confirm()` so every
 * in-game confirmation stays visually consistent with the rest of the OS.
 *
 * Usage:
 *   const ok = await confirmDialog(message, { title: "提示" });
 */
export function confirmDialog(message, { title = "确认", icon = "❓" } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "app-confirm-dialog";

    const text = document.createElement("p");
    text.className = "confirm-dialog-message";
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "win95-btn bevel-out confirm-dialog-ok";
    okBtn.textContent = "确认";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "win95-btn bevel-out confirm-dialog-cancel";
    cancelBtn.textContent = "取消";

    actions.appendChild(okBtn);
    actions.appendChild(cancelBtn);
    root.appendChild(text);
    root.appendChild(actions);

    let settled = false;
    let win = null;

    function settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      if (win) win.close();
    }

    okBtn.addEventListener("click", () => settle(true));
    cancelBtn.addEventListener("click", () => settle(false));

    win = windowManager.createWindow({
      title,
      icon,
      width: 320,
      height: 160,
      resizable: false,
      content: root,
      // Closing via the titlebar ✕ button is treated the same as Cancel.
      onClose: () => settle(false),
    });
  });
}
