# Cultists Engine

This repository contains the reusable Cultists engine: a browser-based desktop and window host, data-driven Activity runtime, CL2 tooling, developer tools, and a small standalone example content package. The engine is maintained independently from the Cultists game; the game project keeps its own content and documentation in the parent repository.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `core/` | Generic host runtime, desktop/windows, data loading, Activity execution, persistence, variables, events, and host capabilities. This is the only layer implemented in native JavaScript. |
| `framework/` | Reusable systems expressed through CL2 blueprints and data. |
| Game content | Lives in the parent repository and uses engine contracts; it is not part of this repository's game-independent engine content. |

The dependency direction is `game → framework → core`. Keep core free of domain-specific behavior and framework independent of a particular game.

## Standalone example

`index.html` starts the engine with `example.data/` as its content root. Serve the repository over HTTP so that browser ES modules and JSON files load correctly. For example, from the repository root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8000/>. The engine entry point reads its content root from the page's `#data-location` element; it does not infer a fixed data directory.

## Development and verification

- `core/`: engine runtime and generic host capabilities.
- `dev/`: developer-mode editors and runtime/save debugging tools.
- `probes/`: deterministic runtime and editor-contract probes.
- `example.data/`: standalone sample content.
- `docs/cl2-language.md`: CL2 language contract.
- `docs/skills/cl2-script-authoring/SKILL.md`: CL2 authoring and validation workflow.

Run the standalone example probe from this repository's root:

```bash
node probes/example-demo-runtime-probe.mjs
```

The CL2 integration probe reads the parent game's `data/` directory, so run it from the game repository root when the engine is checked out as `engine/`:

```bash
node engine/probes/cl2-runtime-probe.mjs
```

For code changes, also run `node --check` on changed JavaScript files and `git diff --check`. Deterministic probes are not a substitute for browser interaction testing; report those results separately.

## License

The engine license and its exact scope are in [`copying.txt`](copying.txt). It applies to the engine repository, not to game content maintained by a separate project.
