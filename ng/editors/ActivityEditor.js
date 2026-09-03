// DEV-TOOLS:START
import { BlueprintEditor } from "./BlueprintEditor.js";

/** Activity-specific entry point; graph behavior stays in the shared blueprint editor. */
export class ActivityEditor extends BlueprintEditor {
  constructor(options = {}) { super({ ...options, fileLabel: options.fileLabel || options.definition?.displayName || options.definition?.id || "Activity" }); }
}
// DEV-TOOLS:END
