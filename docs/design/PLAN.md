# Multi-Host Manager - Paseo plugin plan

## Goal
One matrix view over all connected Paseo hosts. Columns = hosts, rows = properties.
Section 1: host settings. Section 2: plugins (installed version, enabled state, config).
One-click copy of any cell, one-click paste onto any compatible cell on another host, including several hosts in sequence.

## Core concepts
- **Host adapter**: per-host read/write of settings and plugins. One interface, three OS implementations (Windows, macOS, Linux) hidden behind it. UI never touches paths or shells directly.
- **Cell**: `(rowId, hostId)` with a typed value (`text | bool | path | plugin{version, enabled, config}`).
- **Clipboard**: one copied cell, or a whole column section ("Copy column").
- **Staging**: paste never writes immediately. It stages a change; "Apply sequentially" writes host by host with per-item status.
- **Compatibility check** (`evalPaste`): host online, same row type, OS-scoped rows only between same OS family, plugin must support target OS, read-only rows blocked, identical values skipped.

## Cross-OS rules
- Path values are stored as templates (`~/x`) and re-rendered per host (`C:\Users\...` vs `/home/...`).
- OS-scoped rows (shell, start-on-login) only paste within the same OS family.
- Plugins declare supported OS; paste onto an unsupported OS is blocked with a reason.
- Secrets (keys matching token/key/secret/password) are masked and never copied; target keeps its own.

## Paste modes
1. Single: Copy on one cell, Paste on another cell.
2. Sequential multi-host: select target chips in the clipboard bar, "Paste to N selected" stages them in host order, then Apply runs one after another.
3. Whole column: Copy column in one host header, Paste all in another (clones settings or plugins).
4. Cross-plugin config transfer: paste config from plugin A to plugin B on any host; only keys in B's schema are mapped, otherwise blocked.
Plugin paste options: version, config, enabled state.

## Phases
1. **Read-only matrix**: discover hosts, fetch settings and plugin lists, render the grid, offline hosts shown from cache.
2. **Copy/paste + staging** for settings rows (same-row paste, OS rules, path templating).
3. **Plugins**: install/upgrade/downgrade to match version, config copy with secret masking, enabled state.
4. **Multi-target + sequential apply**, per-item status, retry/rollback on failure (snapshot previous value before write).
5. **Column copy, cross-plugin mapping, undo history, export/import of a host profile as JSON.**

## Open questions to verify against the real Paseo plugin API
- How a plugin reaches other hosts (existing host list / per-host server connection) and whether it may read/write config files on them or must go through daemon calls.
- Where plugin config and host settings live on each OS and whether plugins can be installed/upgraded programmatically.
- Whether the plugin UI can be a full-page panel (matrix needs width).

## Files
- `mockup/host-matrix.html` - interactive mockup (also hosted, see chat).

## Revision after the spikes (see FEASIBILITY.md, CAPABILITIES.md)
- Architecture: UI on the hub -> `useRpc` -> hub plugin server (broker) -> routed `DaemonClient` per saved host -> `listPlugins` / `installPluginSource` / `removePlugin` / `enablePlugin` / config calls and the target plugin's own RPC.
- Connections: only the hub's saved hosts are used (pairing link, SSH, tcp). The plugin never reads or stores relay endpoints or passwords. Hub reaches its own daemon with `$PASEO_HOME/local-credential` and the address in `paseo.pid`.
- Gating: per host from `server_info.features`, with `CAPABILITIES.md` as fallback. Hosts below 0.13 are unreachable (`hostMultiplexing`). Plugin `requirements.paseo` blocks installs on older hosts.
- Security policy: plain `tcp://` hosts are blocked by default; relay, SSH and loopback are allowed.
- Rows: real config keys, each tagged live (`config.patch`), reload, restart, read-only or never copied (password, registry credentials).
- Plugins: copy settings, sync version, install (registry/npm/git sources only; directory sources cannot be cloned), remove, enable/disable, update. Installs and removals need an explicit confirmation before Apply.
- Mockup: `mockup/host-matrix-v2.html` (grid and compact phone view).

## Version support policy (proposed)
- **Minimum: 0.13.0.** Hard floor: `connectedHosts` / `hostMultiplexing` arrive there. Manifest `requirements.paseo: ">=0.13.0"`, no upper bound (an upper bound would disable the plugin on every new Paseo release).
  The SDK is the target's (0.14.0). Methods and flags newer than 0.13.0 must be gated on `server_info.features` (e.g. `idleRuntimeCleanupSetting`), because the 0.14.0 types cannot catch a call a 0.13 daemon lacks.
- **Target: newest stable that passed the test matrix** (now 0.14.0; window 0.13.0 to 0.14.0). Supported = every stable release from minimum to target, any patch.
- **Newer stable than target:** runs, header shows "untested". All calls are gated on the host's `server_info.features`, so unknown flags are ignored and missing ones disable the action.
- **Below minimum:** shown as unreachable ("below minimum").
- **Pre-release (beta, rc): unsupported.** Detected by a `-` in `server_info.version`. Blocked by default; header option "Allow pre-release hosts" is an explicit opt-in.
  Evidence: Paseo's own semver rule lets a prerelease satisfy `>=0.13.0`, so the daemon would load the plugin on a beta without warning.
- **Canary:** run the spike test matrix (reach, list, RPC, install/remove, password, relay) against the npm `beta` dist-tag on a schedule. Failures are fixed before the stable release, without promising beta support.
- **Re-verify on every minor** because `@getpaseo/client/internal/daemon-client` is an internal entry. Raise the minimum when Paseo drops a compatibility shim we depend on.
