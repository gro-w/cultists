/** Public NG platform entry point. Composition lives in engine-bootstrap.js. */
export const ENGINE_VERSION = "0.1.0-core";
export { bootstrap, isDevEntry } from "./engine-bootstrap.js";

import { bootstrap } from "./engine-bootstrap.js";

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("ng-root");
    bootstrap(root).catch((error) => {
      /* DEV-TOOLS:START */
      console.error("[NG bootstrap] failed", error);
      if (new URLSearchParams(location.search).get("dev") === "") {
        root.textContent = `NG bootstrap failed: ${error?.message || error}`;
      }
      /* DEV-TOOLS:END */
    });
  });
}
