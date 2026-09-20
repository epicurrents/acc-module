Accelerometry module for Epicurrents
====================================

Modality wrapper for triaxial accelerometer recordings. Source signals arrive on three channels per sensor — one per axis — and magnitude is exposed as a derived signal via `SetupDerivation` so it composes with montages, cascade view, and trends the same way any other channel does.

The module is signal-source-agnostic. Loaders typically use the `csv-reader` package (sibling package in this monorepo), but anything that produces a `BiosignalStudyContext` with the right channel-label shape works.

Magnitude flow
--------------

`AccRecording._applyDefaultSetups()` runs during `prepare()` (lifecycle hook from `GenericBiosignalResource` in `@epicurrents/core`):

1. Parse channel labels into sensor groups via the configured `channelNamePattern` (default `<group>_<axis>`, e.g. `wrist_x`, `wrist_y`, `wrist_z`).
2. For each resolved 3-axis group, emit a `SetupDerivation` with `operation: 'magnitude'`, `active: [xIdx, yIdx, zIdx]`, `reference: []`.
3. The core's materialisation pipeline allocates one cache slot per derivation, the memory budget includes the slot, and the reader computes `sqrt(x² + y² + z²)` sample-by-sample during cache fill.

A group produces a magnitude only when all three axes resolved and agree on a sampling rate. Magnitude is undefined for incomplete sensor data, and silently substituting zero would mislead; axes at different rates are the same problem less visibly, since the materialisation reads every axis at the same sample index and would combine samples from different instants.

The derived signal carries the same display unit as the axes it was computed from. The materialisation is a plain root-sum-of-squares and converts nothing, so a differing unit would only put the derived row on a different scale from its own inputs. Samples themselves are normalised to SI on decode, as for every other modality.

Channel naming
--------------

Default pattern: `^(?<group>[A-Za-z0-9]+)_(?<axis>[xyzXYZ])$`. So `wrist_x` / `wrist_y` / `wrist_z` parse as one `wrist` group; `leftwrist_x` + `rightwrist_x` produce two distinct groups.

Group names match case-insensitively, as axis letters do, so `Wrist_x` and `wrist_y` belong to the same group. The group's display label takes the first spelling seen, capitalised.

Override via `AccModuleSettings.channelNamePattern` with any regex that has named `group` and `axis` captures.

Side-colour map
---------------

`AccModuleSettings.sideMap` maps group-name prefixes to `BiosignalLaterality`:

| Prefix       | Laterality              |
| ------------ | ----------------------- |
| `leftwrist`  | `s` (sinister / left)   |
| `rightwrist` | `d` (dexter / right)    |
| `leftankle`  | `s`                     |
| `rightankle` | `d`                     |
| _unmatched_  | `''` (midline)          |

Lowest-index match wins. The mapped laterality flows into the emitted `SetupDerivation` so trace colours pick the correct side-colour theme automatically.

Montages and cascade view
--------------------------

By default the module's setup exposes the raw source channels plus a derived magnitude channel per sensor group, and montage selection uses regular multi-channel montages as for any biosignal modality. The module additionally produces **cascade montages** as an optional feature — nothing is registered by default, so a consumer opts in by supplying entries.

`AccRecording.addCascadeMontagesFromEntries(entries)` registers cascade montages declaratively. Each entry:

```ts
{
    id: 'wrist',
    label: 'Wrist',
    candidates: ['wrist_mag', 'wrist_x'],  // tried in order
    rowCount: 4,
    pageLength: 30,
    // optional per-entry display defaults:
    sensitivity?, highpass?, lowpass?,
}
```

Candidates resolve against the setup's `derivations` first, then source channels — so `wrist_mag` (the magnitude derivation) wins over `wrist_x` when both are present. This package ships no UI; the cascade montages it produces are rendered by whichever biosignal view the consumer provides.

Filters
-------

Highpass and lowpass only. A notch filter exists to remove mains interference coupled into a voltage measurement, and mains hum does not produce acceleration, so the modality declares no notch in `filterChannelTypes` and the runtime module has no `'notch-filter'` branch.

Public surface
--------------

- `AccRecording` — extends `GenericBiosignalResource`, modality `'acc'`.
- `AccService` — extends `GenericBiosignalService`.
- `AccStudyLoader` — extends `GenericStudyLoader`.
- `AccSourceChannel`, `AccMontageChannel`, `AccCascadeMontage`, `AccEvent`, `AccLabel`.
- `parseSensorGroups(channels, options?)` — pure helper, also useful for non-resource tooling.
- `magnitudeDerivationsForGroups(groups)` — project resolved 3-axis groups into `SetupDerivation[]`.

See `src/types/index.ts` for `AccResource`, `AccSensorGroup`, `AccCascadeEntry`, `AccModuleSettings`, `AccStudyContext`.

What's pending
--------------

- Platform-side integration: `.csv` upload acceptance and `'acc'` modality in the platform enum.
- End-to-end verification against a real recording in a consuming application.
- Optional default sensor-group catalog (wrist-only, wrist+ankle, etc.) if a host wants drop-in defaults beyond the `<group>_<axis>` parse.
