# UI structure (WP8)

React Native screen `hosts` (index.client.tsx: screen, sidebar row, command-center entry). Opened on the hub: its server
is the broker. Mockup: `mockup/host-matrix-v2.html`. No hover: tap a cell to select it, the action bar acts on it.

## State (client/state/)
One reducer, `mhmReducer(state, action)` in `reducer.ts`; pure and unit-tested (`test/unit/client-state.test.ts`).
`useMhm(hostId)` in `hooks.ts` wires it to the RPCs and returns the `MhmController` every component gets
(`MhmSurfaceProps` = `{ theme, layout, controller }`, client/surface.ts).

| `MhmState` field | Meaning |
| --- | --- |
| `hosts` | `mhm.grid.load` hosts, hub first. Replaced on every load (`gridLoaded`). |
| `selection` | `CellRef` (`row` / `plugin` / `doc` + `hostId`) or null. |
| `clipboard` | `ClipboardEntry`: row value, plugin (`GridPlugin`) or settings document (values from `mhm.doc.read`), plus `sourceHost`. |
| `pasteTargets` | Host ids picked for "paste to several hosts". |
| `staged` | `StagedItem[]`: `item` (an `ApplyItem`), `status`, last `outcome`, `requires` / `confirmed` confirmations. |
| `applying`, `dialog`, `view`, `compare` | Apply running; open dialog; `auto`/`grid`/`compact`; compact view's "into"/"from" hosts. |

Controller: `state`, `dispatch`, `policy` + `savePolicy` (broker policy, host-scoped settings doc `broker` on the hub,
`client/state/policy.ts`), `grid.refresh`, `apply()`, `confirm(kind, ids)`, `copyDoc(host, pluginId, settingsId)`.

Rules baked into the state:
- Staged items name saved hosts by `registrationId` (the hub by its id); cells match either id. One item per host and
  slot (`slotOf`): staging again replaces it and drops its confirmations.
- `requires`: `trust` (install), `destructive` (remove), `lockout` (relay off on a relay-linked host or the hub,
  plugins off on any host, this plugin removed/disabled on a remote). Disabling/removing this plugin on the hub is
  never staged (`stageRefusal`). `apply()` opens the missing confirmation first (lockout, destructive, trust), then
  sends the non-applied items with `confirmed: true` where all were given.
- After Apply: per-item `ok` / `ignored` / `failed` / `skipped`; a lost response when the batch switched the hub's
  relay or plugins off becomes `unknown`. The grid reloads after every apply. `clearApplied` drops the `ok` items.
- `planPaste(state, clipboard, hostId)` (clipboard.ts) says what a paste stages or why not; use it for every paste
  affordance (action bar, chips, compact view).

## Who owns what
| Part | File | Owner |
| --- | --- | --- |
| Toolbar, grid, cells, host headers, action bar, compact view | client/grid/ | 8a |
| Clipboard bar (chips per host with `planPaste` reason, `togglePasteTarget`, `pasteTargets`) | client/clipboard/clipboard-bar.tsx | 8b |
| Staging drawer (item list, status/outcome per item, remove, Retry) | client/drawer/staging-drawer.tsx | 8b |
| Trust / destructive / lockout dialogs (`ConfirmDialog`, must call `controller.confirm`) | client/dialogs/confirm-dialog.tsx | 8b |
| Capabilities dialog, plugin menu, install and remove dialogs | client/dialogs/*.tsx | 8b |
| Settings-document editor (masked preview, `writeSettingsDoc` + `reloadPlugin` follow-up) | client/editor/settings-editor.tsx | 8c |

Dialogs open with `dispatch({ type: "openDialog", dialog })` (`DialogRequest` in types.ts) and close with
`closeDialog`; `DialogHost` (client/dialogs/dialog-host.tsx) maps each kind to its component, which gets
`DialogProps` (`MhmSurfaceProps` + `onClose`) plus the request's fields. Dialogs stage through `dispatch({ type: "stage" })`
and never call `mhm.apply` themselves.

## Settings editor (client/editor/)
`SettingsEditor` reads the document (`mhm.doc.read`, masked), edits it as a field list or JSON text and stages `writeSettingsDoc`
(`expectedRevision` = the revision it read) or `restoreSettingsDoc`; a written document keeps "written, validity unknown" for as long as
its staged item exists, with a "Reload plugin" button that stages `reloadPlugin`. Pure logic, unit-tested (`client-editor.test.ts`):
`doc-preview.ts` (`previewWrite`: every key changed/new/removed/kept/secret, never a secret value; `planDocPaste`: drops masked keys the
target lacks, the contract rule), `access.ts` (`editorAccess`: read-only reasons, consent only ever explained, never toggled;
`docStatus`: outcome and conflict text). "Paste from <host>" inside the editor uses the clipboard's document and the target's own read;
the grid-level paste (`planPaste`) stages the clipboard values as they are, so a masked key the target lacks fails the write there
(`invalid_input`) unless it goes through `planDocPaste` first.
