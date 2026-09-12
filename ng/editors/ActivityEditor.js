// DEV-TOOLS:START
import { BlueprintEditor } from "./BlueprintEditor.js";

/** Schedule-specific entry point; graph behavior stays in the shared blueprint editor. */
export class ScheduleEditor extends BlueprintEditor {
  constructor(options = {}) { super({ ...options, fileLabel: options.fileLabel || options.definition?.displayName || options.definition?.id || "Schedule" }); }
}
// DEV-TOOLS:END
