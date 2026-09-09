/** Public NG platform entry point. Composition lives in engine-bootstrap.js. */
export const ENGINE_VERSION = "0.1.0-core";
export { bootstrap, isDevEntry } from "./engine-bootstrap.js";

import { bootstrap } from "./engine-bootstrap.js";

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => bootstrap(document.getElementById("ng-root")));
}
