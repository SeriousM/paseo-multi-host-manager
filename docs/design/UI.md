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
| `writtenDocs` | "Written, validity unknown" markers per host, plugin and document; outlive `clearApplied`, cleared by a successful reload of that plugin or `dismissWritten`. |
| `baseline`, `onlyDifferences` | Host reference every other host is compared with (`client/state/compare.ts`), and the "Only differences" filter. |
| `applying`, `applyNote`, `dialog`, `view`, `compare` | Apply running; why the last Apply did not start or lost its result (drawer line, cleared by the next Apply); open dialog; `auto`/`grid`/`compact`; compact view's "into"/"from" hosts. |
| `focusHost` | Registration id of a host Add host just saved; the first grid load that has it selects its header (`hostAdded`, then `gridLoaded`). |

Controller: `state`, `dispatch`, `policy` + `savePolicy` (broker policy, host-scoped settings doc `broker` on the hub,
`shared/policy.ts`, `policyNote` when it fell back to defaults), `grid.refresh`, `apply()`, `confirm(kind, ids)`, `copyDoc(host, pluginId, settingsId)`,
`addHost({ connection, label, allowUnencrypted })`.

Rules baked into the state:
- Staged items name saved hosts by `registrationId` (the hub by its id); cells match either id. One item per host and
  slot (`slotOf`): staging again replaces it and drops its confirmations.
- `requires`: `trust` (install), `destructive` (remove), `lockout` (relay off on a relay-linked host or the hub,
  plugins off on any host, this plugin removed/disabled on a remote). Disabling/removing this plugin on the hub is
  never staged (`stageRefusal`). `apply()` opens the missing confirmation first (lockout, destructive, trust), then
  sends the non-applied items with `confirmed: true` where all were given.
- Apply and Retry send only `SENDABLE` items (pending, failed, skipped); ignored and unknown ones wait for a reload or removal.
- Apply runs as a job on the hub (`client/state/apply-run.ts`): `mhm.apply.start`, then `mhm.apply.poll` every second
  (`applyProgress` merges the items settled so far). A plugin RPC has 30 s on the daemon, less than one install may
  take; there is no synchronous apply RPC. The hub applies hosts one after the other in its directory order, the hub
  last; the drawer lists them in that order. While `applying`, every staging action is ignored and results merge only
  into items being applied.
- No transport problem marks an item `failed`. A busy hub or a start call that fails ran nothing: the items go back to
  `pending` (`applyNotStarted`). A failing poll is retried with a doubling delay (up to 8 s) for about 30 s; after that,
  or when the hub no longer knows the job, the items still applying become `unknown` ("Result lost; reload the grid
  before retrying", `applyLost`) and Retry leaves them out.
- `updateChecks`: a check-only update that found an update shows "update available" on the plugin cell until the
  host reports another version or the user presses Refresh.
- Failure texts per code and detail live in `client/state/failure-text.ts` (cells and drawer).
- Settings documents are never pasted by the grid: the action bar and the clipboard bar open the editor on the target. This plugin's own documents are read-only (the companion refuses remote writes to them).
- After Apply: per-item `ok` / `ignored` / `failed` / `skipped` from the hosts, or `unknown` when the result was lost
  (see above). The grid reloads after every apply. `clearApplied` drops the `ok` items.
- `planPaste(state, clipboard, hostId)` (clipboard.ts) says what a paste stages or why not; use it for every paste
  affordance (action bar, chips, compact view).

## Add host (client/dialogs/add-host-dialog.tsx)
The one direct action: `mhm.hosts.add` saves a host in the hub daemon's directory (`addHost`, as `paseo host add`) when
the user presses Add; it never goes through staging or Apply. Opened from the toolbar ("Add host...") and from the
hub-only panel. The connection field is a password field (`secureTextEntry`); the text leaves the dialog only in the
RPC call, and no result or failure carries it back. `add-host-rules.ts` (`addHostView`, tested in
`test/unit/client-add-host.test.ts`) classifies the text with `shared/connection.ts` (`connectionLink`, the grammar of
Paseo's `parseHostTarget`; the server checks again with Paseo's parser, and a unit test keeps the two in step). A plain
non-loopback TCP link shows "I understand this link is not encrypted"; Add stays disabled until it is ticked, and the
server refuses it without `allowUnencrypted` (`insecure_link` / `unencrypted_link`). After a confirmed plain link the
controller adds its registration id to the policy's `insecureLinkRegistrationIds`, the same allowance the capabilities
dialog gives a saved host. On success: `hostAdded`, grid reload, the new column selected. The server waits up to 10 s
for the hub's first connect, so the returned status is usually `online` or the reason it is not.

## Layout (client/grid/layout.ts, palette.ts)
Type scale `TYPE` (body 15, secondary 13, monospace values 14, badges 12, headings 16/18) with `font(size)` for a
1.4 line height. Row and header heights in `SIZES` are fixed so the label column lines up with the host columns.
`gridLayout(width, hosts, hubOnly)`: host columns share the measured width next to the 290 px label column, each
between 220 and 420 px; below 220 they keep that width and scroll sideways. A reachable hub without saved hosts
(`hubOnly`) gets the explanation panel beside its column (and instead of the pickers in the compact view): why only
the hub shows, the two host lists, "Add host..." and the CLI command.

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
and never call the apply RPCs themselves.

## Settings editor (client/editor/)
`SettingsEditor` reads the document (`mhm.doc.read`, masked), edits it as a field list or JSON text and stages `writeSettingsDoc`
(`expectedRevision` = the revision it read) or `restoreSettingsDoc`; a written document keeps "written, validity unknown" for as long as
its staged item exists, with a "Reload plugin" button that stages `reloadPlugin`. Pure logic, unit-tested (`client-editor.test.ts`):
`doc-preview.ts` (`previewWrite`: every key changed/new/removed/kept/secret, never a secret value; `planDocPaste`: drops masked keys the
target lacks, the contract rule), `access.ts` (`editorAccess`: read-only reasons, consent only ever explained, never toggled;
`docStatus`: outcome and conflict text). "Paste from <host>" inside the editor uses the clipboard's document and the target's own read;
the grid-level paste (`planPaste`) stages the clipboard values as they are, so a masked key the target lacks fails the write there
(`invalid_input`) unless it goes through `planDocPaste` first.

Notes from 8b:
- `{ kind: "install", pluginId: "", hostId: null }` opens the install dialog for a new plugin from a typed source (registry id, `npm:`, `git:`); credentials in the URL and local directories are refused with the server's rules.
- The clipboard bar stages row and plugin pastes with `pasteTargets`. For a settings-document clipboard its chips open the editor on that host instead (the editor reads the target document first, so masked secrets keep the target's own values).
- The trust dialog has two checkboxes when a source is not pinned ("installs the latest release"); destructive and lockout have one. Pure view logic: `drawer/staging-view.ts`, `dialogs/confirm-text.ts`, `dialogs/plugin-rules.ts`, `dialogs/capability-report.ts`, `clipboard/paste-chips.ts` (tests: `test/unit/client-dialogs.test.ts`).
- "Install companion" in the capabilities dialog stages this plugin from the hub's own source (`companionInstall`: registry, npm or git, pinned where that source pins), the registry id only when the hub's source is unknown, and nothing when the hub runs a directory install.

## Baseline comparison (client/state/compare.ts)
Tap a host header: the action bar offers "Use as baseline" / "Clear baseline", "Stage N from baseline" and Capabilities.
With a baseline, `compareRowCell` / `comparePluginCell` lay a compare state over every cell: `baseline`, `same`,
`differs`, `missing` (the baseline has it, this host not) or `not_comparable` (a blocked host or baseline, or a side
that cannot be read: companion missing, needs a newer Paseo, unreadable, never read). Rules:
- Settings rows compare deeply; a leaf that is masked on either side is skipped ("secrets not compared" when that
  is the only possible difference). Facts about the host (version, OS) and host-specific rows (listen, saved
  connection, worktree root) are compared but only inform: they are not counted in a header's "N differ" and do not
  keep a row in "Only differences".
- Plugins compare installed or not, version (`compareVersions`: older / newer / other revision) and enabled state.
- Pending and applying staged items count as done: a cell compares the value it will have after Apply.
- A baseline replaces the clipboard's source/differs highlight. "Copy from baseline" and "Stage N from baseline" go
  through `planPaste`: every paste rule and confirmation applies; what cannot be staged is listed with the reason.
  A providers difference is refused when the target has none of the baseline's provider ids (providers are only
  updated, never created, from here); otherwise the server updates the ids the target has.
- Setting a baseline makes it the compact view's "Pull from" host. The baseline survives reloads by registration id.
