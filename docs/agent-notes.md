# Engine Development Notes

This file is the maintenance index for the engine repository. Game-specific data, authoring workflows, and promotional materials belong in the parent repository; this document covers only generic engine implementation and tooling.

## Repository map

```text
core/                  Generic browser host, windows/widgets, Activity runtime, persistence, and capabilities
framework/             Reusable framework blueprints and data
dev/                   Developer-mode editors and runtime/save debugging tools
example.data/          Standalone sample content package
probes/                Deterministic engine and editor-contract probes
docs/cl2-language.md   CL2 language and graph contract
docs/skills/           Engine-specific authoring workflows
index.html             Standalone engine entry; selects example.data/
```

The page's `#data-location` value selects the content root. `core/entrypoint.js` resolves it relative to the HTML document and bootstraps the engine with that explicit root. The root game project supplies its own `index.html` and content root outside this repository.

## Architectural boundary

- `core` owns generic runtime services and is the only layer that may use native JavaScript implementation.
- `framework` expresses reusable systems in CL2 and data; it must not depend on a specific game.
- Game content is maintained outside this engine repository and depends on `framework` and `core`, not the reverse.
- Activity manifests and their referenced source files define the canonical Activities. CL2 (`.CL2.txt`) is the production source format for Activities that the manifest points to it; do not infer canonical status from an unreferenced export.
- Windows and widgets use declared data/blueprint contracts. Runtime effects go through public Activity/runtime capabilities rather than UI-side state mutation.
- The developer-mode editors, save debugger, and runtime debugger have distinct responsibilities: canonical content edits remain content files; save/debug tools inspect or modify runtime/save state.

## Useful source locations

- `core/entrypoint.js`, `core/engine-bootstrap.js`: explicit content-root startup.
- `core/Cl2Parser.js`, `core/Cl2Validator.js`, `core/Cl2Compiler.js`, `core/Cl2CodeGenerator.js`: CL2 parsing, validation, and execution compilation.
- `core/ActivityDefinitionStore.js`, `core/ActivityRunner.js`, and `core/ActivityQueue.js`: Activity loading, execution, and queue state.
- `dev/ActivityEditorView.js`, `dev/ActivityDebuggerView.js`, `dev/DatabaseEditorView.js`, and `dev/SaveDebuggerView.js`: representative editor/debugger entry points.
- `publish.js`, `verify-publish.js`: player-build generation and verification scripts; inspect their behavior before running because they create and remove a `publish/` directory.

Consult the relevant source and schema before relying on these names or contracts; this index is not a substitute for current code.

## Local development

Serve the standalone engine root over HTTP:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`. `dev-server.js` documents its supported options in its header; it binds to localhost and should not be exposed to public networks.

## Verification

Choose deterministic probes based on the changed contract. Probe files are under `probes/`; verify a probe's current existence before citing or running it. For JavaScript edits, run `node --check` on changed files. For JSON edits, parse all affected JSON. Run `git diff --check` in both the engine worktree and, when working as a submodule, the parent worktree. Static checks and probes do not establish that browser UI interactions work; verify those separately when required.

## Related documents

- [`../AGENTS.md`](../AGENTS.md): engine repository contributor rules.
- [`../README.md`](../README.md): engine overview and standalone usage.
- [`cl2-language.md`](cl2-language.md): CL2 language contract.
- [`skills/cl2-script-authoring/SKILL.md`](skills/cl2-script-authoring/SKILL.md): engine CL2 workflow.
- `copying.txt` at the repository root: engine license.
