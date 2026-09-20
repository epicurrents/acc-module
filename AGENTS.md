# @epicurrents/acc-module — architecture notes for AI coding assistants

This file is the entry point for AI coding assistants working in the `@epicurrents/acc-module` package: accelerometry modality support for the Epicurrents viewer. It is tool-agnostic.

The package follows the study-module pattern that [eeg-module's AGENTS.md](../eeg-module/AGENTS.md) documents as the reference implementation — the same `src/` layout and the same resource / setup / montage / service decomposition. Read that file for the shared pattern, the activation lifecycle and the SAB cache rules; this file covers only what accelerometry adds, and [README.md](README.md) carries the narrative description of the module's behaviour.

## Toolchain compliance — HIGH PRIORITY

This package depends on `@epicurrents/core` and shares a single toolchain with it. **Never pin package-specific versions that diverge from the canonical set** — a divergent TypeScript produces structurally incompatible `.d.ts` files that type-check locally but corrupt data at runtime, because worker-side and main-thread code can then disagree on data layouts while everything still compiles.

| Tool | Version |
|---|---|
| `@epicurrents/core` | `^2.0.0` |
| TypeScript | `^5.7.0` |
| Vite | `^7.3.1` |
| ESLint | `^9.19.0`, flat config in [eslint.config.mjs](eslint.config.mjs) |
| tsconfig base | extends `@epicurrents/core/tsconfig.base.json` |

`npm run build` produces one artifact, the ESM `dist/`: [vite.config.mjs](vite.config.mjs) emits the JavaScript and `epicurrents-build-types` from core emits the declarations, rewriting their `#` aliases into paths a consumer can resolve. The module has no worker of its own, so it needs no standalone bundle.

The core version appears in three places that must agree — `devDependencies`, `peerDependencies`, and the APIs the source actually calls. The workspace symlinks core rather than installing it, so a stale range type-checks and builds perfectly against whatever version is checked out; only an external consumer sees the mismatch, as a core that lacks the APIs this package calls. Bump the range in the same commit as any change that depends on a new core API.

## The magnitude derivation

Magnitude is the reason this module exists. It is **declared** here and **computed** in core, and the split is the thing to keep straight when changing either side.

1. `parseSensorGroups` (in [src/util.ts](src/util.ts)) parses source-channel labels into sensor groups via the configured `channelNamePattern`.
2. `magnitudeDerivationsForGroups` projects each resolved group into a `SetupDerivation` carrying `operation: 'magnitude'` and `active: [xIdx, yIdx, zIdx]`.
3. `AccRecording._applyDefaultSetups()` puts those on the setup during `prepare()`.
4. Core takes it from there: `GenericBiosignalResource._derivationCacheSlots` sizes one cache slot per derivation, and `GenericSignalReader._materialiseDerivation` computes `sqrt(Σᵢ (activeᵢ × weightᵢ)²)` during cache fill.

Because the arithmetic lives in core, a change to the emitted shape is a cross-package change. `BiosignalDerivationOperation` in core's `types/biosignal.ts` is the authority on which operations exist; adding one means extending that union and its dispatch in core first.

### Sampling rates across the axes are the module's own responsibility

Core's `_materialiseDerivation` reads every active input at the same sample index `i`, and its docstring states plainly that all inputs must share the slot's rate: "caller is responsible for that being consistent across the active set." Core does not verify it, and cannot — an index is all it has.

So a group whose axes carry different sampling rates yields a magnitude computed from misaligned samples, and past the shortest axis's length the missing samples read as zero, degenerating the result to `sqrt(x² + y²)` without any error. Nothing downstream makes this visible; the trace simply looks like a plausible accelerometry signal.

Note the shape of the trap before relying on `samplingRate` as a signal of trouble: `parseSensorGroups` sets a group's `samplingRate` to `0` when its axes disagree, but core reads that field as `deriv.samplingRate || this._resolveDerivationSamplingRate(deriv)`, so a zero is not a refusal — it falls back to the **first active input's** rate, which is the x axis.

### Partial groups are dropped deliberately

`magnitudeDerivationsForGroups` skips any group missing an axis. Magnitude is undefined for incomplete sensor data, and substituting zero for the absent axis would produce a smaller-but-plausible signal rather than an obvious failure. Keep this behaviour when editing the projector.

## Channel naming

Default pattern: `^(?<group>[A-Za-z0-9]+)_(?<axis>[xyzXYZ])$`, overridable through `AccModuleSettings.channelNamePattern`.

Two properties of the parse that a custom pattern must preserve:

- **The named captures `group` and `axis` are load-bearing.** `parseSensorGroups` reads `match.groups.group` and `match.groups.axis`; a pattern that matches the labels but names its captures differently produces zero groups and therefore no magnitude at all, silently.
- **A channel with no resolvable index is skipped.** The index comes from `(ch as SourceChannel).index ?? -1` and a negative index drops the channel, so a `BiosignalChannel` that carries no index contributes nothing to a group even when its label parses.

## Internal path aliases

Two alias tables have to agree, and they are not written the same way. [tsconfig.json](tsconfig.json) maps `#*` to `src/*` — a wildcard, so any name resolves. `ALIASES` in [vite.shared.mjs](vite.shared.mjs) enumerates the directories explicitly, because the package declares no `imports` field and an unlisted alias has nothing to fall through to.

The asymmetry means **a new top-level directory under `src/` type-checks and fails to build**: `tsc` resolves `#newdir` through the wildcard while Vite and Vitest do not. Add the name to the regex in [vite.shared.mjs](vite.shared.mjs) in the same commit that creates the directory.

## Tests

`npm test` runs Vitest; `vitest` and `@vitest/coverage-v8` come from the workspace root rather than this package's own `devDependencies`.

**Test the exported code, not a copy of it.** The module's classes import cleanly under jsdom, and a method that reads only a few members of `this` can be exercised through `Prototype.method.call(stub, …)` without booting the activation lifecycle — [tests/cascade.test.ts](tests/cascade.test.ts) does this for `addCascadeMontagesFromEntries`. A test that re-implements the logic it is checking passes regardless of what the production code does, which is worse than no test: it reports coverage of a method it cannot fail on.

The corollary for review: when a test file declares a local helper that mirrors a production function, check whether the assertions reach the real one.

## Code comment conventions

Comments and docstrings describe the code's **current contract** — what it does and the invariants it upholds, for a reader who has never seen an earlier version.

- **No change history, migration state or roadmap phases.** Don't narrate what the code used to do or which delivery stage a collaborator belongs to; a reader has no way to date the remark. That belongs in the commit message, where `git blame` surfaces it.
- **Describe the layer's own contract, not its consumers.** State the invariant the layer guarantees so it holds regardless of who calls it.
- **Keep the `@package` / `@copyright` / `@license` header** on every source file.
- **Wrap TypeScript source at a 120-column soft cap** — code, docstrings and comments alike. The one exception: `@param` docstrings stay on a single line regardless of length, because wrapping them renders poorly in the VS Code hover. Do not hard-wrap Markdown prose: one line per paragraph, since docs are read as rendered output at varying widths.
