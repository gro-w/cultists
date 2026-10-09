# Engine Repository Rules

This file governs work inside the `engine/` repository only. For the game project's content rules, see the parent repository's [`AGENTS.md`](../AGENTS.md). Engine structure, commands, and source-of-truth notes are in [`docs/agent-notes.md`](docs/agent-notes.md); the standalone engine overview is in [`README.md`](README.md).

## Scope and architecture

- Keep this repository game-agnostic. Do not add the Cultists game's patients, dialogue, schedule, story, branded promotional materials, or other game-specific content here; those belong in the parent repository.
- Keep engine implementation, generic development tools, engine documentation, and the standalone `example.data/` package here.
- Preserve the dependency direction `game → framework → core`. `core` provides generic host/runtime capabilities; `framework` provides reusable systems; game-specific behavior belongs in the parent repository.
- Native JavaScript implementation is restricted to `core`. Implement reusable framework behavior and game behavior with the engine's CL2 blueprints and data contracts; do not add game-specific JavaScript modules.
- Before adding a host capability or CL2 node, inspect existing public contracts and callers. Keep new capabilities domain-neutral and document their inputs, outputs, side effects, and persistence requirements.

## Data and runtime

- Use stable IDs for persistent references; never use display labels, translations, or character names as identifiers.
- CL2 (`.CL2.txt`) is the canonical Activity source format where referenced by the Activity manifest. Check the manifest before treating another file as canonical.
- Keep Activity side effects in the Activity runtime and its public APIs. Windows and widgets may request actions and display results; they must not bypass the runtime to change game state or advance game time.
- Keep simulation state deterministic and independent of wall-clock time. Persist only state owned by the relevant runtime/service and preserve its snapshot/restore contract.
- Keep developer tools and local disk-writing APIs out of player runtime paths. Canonical data editors and save/runtime debuggers must remain separate.

## Change and verification

1. Read the relevant code, schemas, contracts, callers, and nearby probes before editing; check both parent and engine Git status.
2. Make the smallest scoped change. Use LF line endings for text files and preserve unrelated work.
3. For JavaScript changes, run `node --check` on changed files. For JSON changes, parse all relevant JSON. For CL2/runtime changes, run relevant deterministic probes.
4. Run `git diff --check` in this repository and in the parent repository. Report deterministic/static checks separately from real browser interaction.

## Licensing and assets

- Engine code and materials are governed by this repository's [`copying.txt`](copying.txt). That license does not grant rights to content maintained in the parent game repository.
- Confirm the license and attribution requirements for external code, data, images, audio, video, and fonts before adding them. Do not assume that free-to-download means commercially usable or redistributable.
