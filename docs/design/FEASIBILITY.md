# Feasibility vs. the Paseo plugin SDK

Sources: paseo.sh/docs/plugins/reference, paseo.sh/docs/sdk/reference, paseo.sh/docs/configuration,
getpaseo/paseo docs/plugins.md, and the local `~/.paseo` files on this machine.

## Verdict per planned operation

| Operation | Verdict | How / blocker |
| --- | --- | --- |
| List all hosts in one overview, with online status | YES | `useHosts()` (app-known hosts) or `usePaseo().hosts.list()/observe()` (hosts saved on the selected daemon). Offline hosts included. |
| Call a remote host | YES | `getPaseoClient(serverId)` / `hosts.client(serverId)`. Plugin does not need to be installed on the target. Routing is one hop. |
| Read host settings from a remote host | PARTIAL | Only `client.config.get()`: the "mutable" subset. |
| Write host settings on a remote host | PARTIAL | Only `client.config.patch()`, same subset, and it affects every client of that daemon. |
| List installed plugins + versions on a remote host | NOT VIA SDK | `PaseoApi` = projects, workspaces, agents, terminals, providers, config, hosts. No `plugins` namespace. |
| Install / update / enable / disable a plugin on a remote host | NOT VIA SDK | Exists only as CLI (`paseo plugin add/update/enable/disable/remove`, `--host`) and the Settings UI. |
| Read / write another plugin's configuration | NOT SUPPORTED | Plugin settings are plugin-private. Only direct file access is possible. |
| Transfer config from plugin A to plugin B | NOT SUPPORTED | Schemas are private Zod objects; nothing to introspect or map. |
| One-click copy / paste / sequential multi-host paste (UI) | YES | Pure client UI plus staging. |
| Cross-OS | YES for UI and local server side | Client is React Native (iOS, Android, web, desktop). Server side is Node on the daemon host. |

## Details

### Host settings
- `config.get/patch` covers (from protocol schema, older snapshot - re-verify on current version): `mcp.injectIntoAgents`,
  `browserTools.enabled`, `providers`, `metadataGeneration`, `autoArchiveAfterMerge`, `enableTerminalAgentHooks`,
  `appendSystemPrompt`, `terminalProfiles` (schema is passthrough, so more may exist, e.g. `agentProfiles`).
- File-only, not SDK-reachable: `daemon.listen`, `daemon.hostnames`, `daemon.relay.*`, `daemon.auth.password` (never copy),
  `worktrees.root`, `log.*`, `agents.idleRuntimeCleanup`, `pluginsEnabled`, `pluginRegistries` (contains credentials).
  Some apply on `paseo reload`, others need `paseo daemon restart`.
- Several rows in the first mockup (default provider/model/mode, shell, start on login, auto-update, telemetry, log level
  as a copyable value) do not exist as documented host settings. They must be replaced by the real keys above.

### Plugin inventory and install
- Local files on a host: `~/.paseo/config.json` `plugins.<id> = { source:"directory", path:<absolute, machine-specific>, enabled }`
  and `~/.paseo/plugins/sources.json` `<id> = { kind: npm|git, remote?, registry:{url,id} }`.
  Portable identity lives in `sources.json`, NOT in `config.json` (its paths differ per machine/OS).
- Registry installs cannot pin a version ("explicit version/ref selection is unavailable for registry installs"). Syncing means
  "install the same registry id"; you get the registry-approved revision. Exact version match works only for npm (`npm:pkg@x`) and
  git (`--ref`) sources.
- Plain directory sources cannot be cloned: files are never uploaded.
- Install = "I trust this codebase" (unsandboxed code on the target). Docs say never enable plugins on a user's behalf without explicit
  permission. Needs per-install confirmation, `pluginsEnabled: true`, and `npm` on the target for npm sources.

### Plugin configuration
- `defineSettings` documents are host-scoped JSON: `~/.paseo/plugin-settings/<pluginId>/<settingsId>.json` = `{ "version": n, "values": {...} }`.
  Docs: no cross-host synchronization, "not a credential vault" (secrets may sit inside).
- File-level copy is technically possible but unsanctioned: bypasses revision/validation, a newer `version` than the target plugin knows
  becomes `invalid`, plugin likely needs `paseo plugin reload <id>`, values may hold OS paths or secrets. Some plugins keep state elsewhere
  (client-side storage), which is invisible to this approach.
- Safe scope: same plugin id on both hosts, source version <= target schema version, secret-looking keys excluded, validated by the plugin on reload.

## Executor options for remote hosts (the real design decision)
The SDK gives us a remote API, but no remote file or plugin access. Three ways to get it:

1. **Remote terminal via SDK** (`remote.terminals.create/capture`): runs `paseo plugin ls --json`, `cat`, etc. on the target. No extra credentials.
   Needs a workspace on the target (path must exist there), output is a PTY screen capture (ANSI, wrapping, no exit code), shells differ per OS. Fragile but SDK-only.
2. **Companion**: this plugin installed on each host, exposing its own RPC for list/export/import. Clean and cross-OS, but I found nothing documenting
   how a surface calls a plugin RPC on a host other than the selected one. Needs a spike.
3. **SSH from the plugin server** (`ssh user@host paseo plugin ...`): deterministic, but needs user-provided SSH access and is outside the SDK.

## Spikes to run before building
1. Does `client.config.get()` on a remote return `plugins`/`pluginsEnabled`, and which keys does `patch` accept on the current version?
2. Can `useRpc` target a host other than the selected one (companion approach)?
3. Terminal approach: reliable run-and-capture of `paseo plugin ls --json` on a Windows and a Linux remote.
4. Does editing a `plugin-settings` JSON file plus `plugin reload` pick up the new values?
5. Minimum Paseo version for `hosts` API and `terminals` (older hosts throw "update-host").

## Revision: plugin on every host, pull instead of push

Confirmed in docs: plugins are installed per daemon. The same contribution on several hosts shows as one sidebar item plus a host picker.
The selected host supplies the bundle, Paseo API, RPC transport and query cache. Switching the screen's host switches both `usePaseo()` and
`useRpc()` to that host's installation. Calls never fall through to another host.

### What the pull model fixes
- All writes become local to the host being changed. Its own plugin server (Node, runs on that OS) runs `paseo plugin add`,
  `config.patch`, writes `plugin-settings` files. No remote exec, no remote credentials, one trust confirmation on the machine that changes.
- OS differences (paths, CLI location, shell) are handled by the plugin copy running on that OS.
- The source host's plugin does the export: local reads of config subset, `sources.json`, `plugin-settings`, with redaction at the source.
  Output is a versioned "host snapshot" JSON (OS, Paseo version, plugin id/source/version/enabled, plugin settings minus secrets).

### What it does not fix
Moving the snapshot from B to A. Documented reach from A to B is only `getPaseoClient(B)` / `hosts.client(B)` = plain `PaseoApi`; no plugin RPC.
`useRpc` is bound to the selected host with no per-call host argument.

| Snapshot transport | Documented? | Notes |
| --- | --- | --- |
| A server calls B's plugin RPC | No | Best UX. Spike 2. |
| Host-picker relay: export via `useRpc` on B, hold in client memory, switch picker to A, import | Partly | Needs client state to survive a host switch (bundles are per host). Screen params are strings only. Spike 2b. |
| Share string: B uses `copyText`, A pastes into a `TextInput` (or file export/import) | Yes | Works on all platforms incl. mobile. One extra manual paste. |
| Shared location (synced folder, git repo, HTTPS) each plugin publishes to and reads from | Yes (Node fs/network in server) | Async, works for offline hosts via last snapshot. Needs one shared place. |
| Remote terminal / SSH | SDK / outside SDK | Fallback only. |

### Consequences
- Multi-host paste in sequence becomes: pull into A, switch picker to C, pull again (unless live transport works).
- UI becomes "this host vs source": two-column compare with per-row Pull, instead of an N-column matrix.

## Spike results (2026-10-28, Paseo 0.13.2, Windows, two daemons on one machine)
Setup: daemon A = the normal desktop daemon (127.0.0.1:6767). Daemon B = throwaway home `C:\temp\paseo-b` on 127.0.0.1:6768, saved on A with
`paseo host add 127.0.0.1:6768 --label daemon-b`. Probe plugin `spike/host-rpc-probe` installed on both. Raw result files were deleted during cleanup; the probe source is kept in `spike/host-rpc-probe`.

| # | Test | Result |
| - | --- | --- |
| 0 | Node script, `createHostClient(conn)` from `@getpaseo/client/node`: `listPlugins()` and `invokePluginRpc("host-rpc-probe","probe.ping")` on A and B | PASS. Different pids and PASEO_HOME per host. |
| 1 | Inside plugin A's server subprocess: `paseo.hosts.client(B)` (the documented API) | Works, but `PaseoApi` has only agents, config, hosts, observeEvents, projects, providers, terminals, workspaces. No plugin members, no hidden DaemonClient. |
| 2 | Same call: `remote.config.get()` on B | Returns `pluginsEnabled` and `plugins` (the old protocol snapshot was outdated). Entries are `{source, path, enabled}` with machine-specific paths. |
| 3 | Plugin A server, direct connection string to B (`createHostClient("127.0.0.1:6768")`), `listPlugins` + `invokePluginRpc` on B's probe | PASS |
| 4 | Plugin A server, routed through A's saved-host registry: `createHostClient(A)` + `origin.openHostRoute(B)` + `createHostChannelTransport` + `new DaemonClient(...)`, then `listPlugins` + `invokePluginRpc` | PASS. No credentials for B needed. This is the CLI's own mechanism. |
| 5 | Same routed client, write path on B: `installPluginSource({source:"hichamboushaba/keep-awake"})`, `listPlugins`, `removePlugin` | PASS. Installed (rev 0.1.3, status running) and removed. |
| 6 | Client-side `useRpc` signature | `(input) => Promise`, no host parameter (static types). So the UI of A can only call A's handlers; A's server must broker. |

### Conclusion
Cross-host plugin RPC works, with the plugin's own server as the broker:
UI (host A selected) -> `useRpc` -> A's handler -> routed `DaemonClient` to B -> `invokePluginRpc` / `listPlugins` / `installPluginSource` / `enablePlugin`.
This gives us everything the CLI can do, on every saved host, with one UI and no extra credentials for B.

### Caveats found
- Uses `@getpaseo/client/internal/daemon-client` (`DaemonClient`) plus `openHostRoute`. Only `createHostClient` / `createHostChannelTransport` live in the non-internal `/node` entry.
  Internal API: can break between Paseo releases. Pin `requirements.paseo` and re-test on every release.
- `@getpaseo/client` must resolve inside the plugin subprocess. It did here because it is installed in the plugin directory. For registry/npm distribution it has to be a runtime
  `dependency` whose version matches the daemon.
- The probe needed an "origin" connection to its own daemon (`127.0.0.1:6767`). Subprocess env gives `PASEO_HOME`, `PASEO_CLI`, `PASEO_DESKTOP_MANAGED` but no listen address;
  `$PASEO_HOME/paseo.pid` contains `listen` and `serverId`. If a daemon has a password or a non-default listen address the origin connection must use them (untested).
- `paseo` is not provided to the plugin setup function, only to handlers and hooks.
- Not tested: password-protected daemon, relay/SSH-saved hosts, a Linux/macOS target, the app UI itself (host picker, `Ping` button), `paseo plugin reload` on the target after settings-file writes.

## Spike round 2: passwords, relay, Linux, versions (2026-10-28, Paseo 0.13.2)
Topology tested: Windows daemon A (default port, no password), Windows daemon B (port 6768, password, relay enabled via the public relay),
Linux daemon (Debian 12 under WSL2, port 6769, password). Probe plugin on all three.

| # | Test | Result |
| - | --- | --- |
| 7 | Direct connection to password-protected B: no credential / wrong password / password / `localCredential` | password_required / incorrect_password / PASS / PASS |
| 8 | Plugin on password-protected B, origin = its own daemon, using `$PASEO_HOME/local-credential` and the address from `$PASEO_HOME/paseo.pid` (port 6768) | PASS. The plugin never needs the daemon password for its own daemon. |
| 9 | A routed to password-protected B saved with `tcp://...?password=...` | PASS. Credential is held by A's daemon in its saved-host registry. `targetDescription` does not show it. |
| 10 | A routed to B saved as a relay host `relay://relay.paseo.sh:443/<serverId>?key=<daemon public key>&ssl=true` plus password | PASS. B's daemon log shows `transport: relay`. Round trip ~1.2 s. |
| 11 | Windows A routed to Linux daemon (port 6769, password) | PASS. Ping reports platform linux. |
| 12 | Linux daemon as broker, password-protected, routed over relay to Windows B | PASS. Plugin ran on Linux with the same code. |
| 13 | Saved host with wrong/missing password | Host status `error`, code `authentication_failed`, message "Host rejected the credentials". Usable for UI warnings. |
| 14 | `server_info` of each daemon | Contains `version`, `protocolVersion`, `features` (about 90 flags), `capabilities`, `permissions`, `desktopManaged`. Basis for runtime capability gating. |

### Findings that change the design
- **Two host lists.** The app's host list (what `useHosts()` shows, paired in the app) is not the daemon's saved-host registry (`hosts.json`, `paseo host`, `paseo.hosts.*`).
  Routing only uses the daemon registry. Each broker daemon needs the other hosts added once (pairing link, `ssh://`, or `tcp://`). The plugin can offer "Add host" via `paseo.hosts.add`.
  Pick one hub daemon (e.g. the Windows machine) that has all other hosts saved, and open the grid there.
- **Per-host relay is automatic.** A relay connection string carries its own endpoint, host id and public key. The plugin never reads or needs the relay configuration.
- **Security chain.** plugin -> own daemon over loopback with the local credential, then daemon -> host over that host's saved transport (relay E2EE, SSH, or tcp+password).
  Relay and SSH are encrypted. Plain `tcp://` with a password is NOT encrypted: the plugin must read `targetDescription` and flag/deny `tcp://` to a non-loopback address.
  Paseo stores saved-host connection strings, including passwords, in plaintext in `$PASEO_HOME/hosts.json`. That is Paseo's behaviour; our plugin must not copy it anywhere.
- **Version gates (from published protocol packages).** See `CAPABILITIES.md`. `connectedHosts` and `hostMultiplexing` arrive in 0.13.0: a daemon older than 0.13 can neither broker nor be routed to.
  Plugin management exists since 0.8.0, source installation/updates since 0.9.0.
- `PASEO_HOME` was set in both plugin subprocesses. Fall back to `~/.paseo` when it is not.

## Open another plugin's settings screen (checked 2026-10-29, Paseo 0.13.2)
- Plugins register screens with `client.addSettingsScreen({id,title,icon,Component})`; they show under Settings > Hosts > <host> > Plugins > <plugin>
  (app route `/settings/hosts/[serverId]/plugins/[pluginId]/[screenId]`).
- `client.openSettings(id)` / Command Center `openSettings(id)` open only the calling plugin's OWN screens. The app binds the plugin id and rejects unknown ids
  ("Plugin settings screen is unavailable"). `navigation` offers only `openAgent`, `openWorkspace`, `openBrowser`.
- There is no API to list another plugin's settings screens. `getPluginCatalog()` returns only `{id, clientBundle, requirements}`.
- Consequence: the "Open settings" menu item is NOT achievable for third-party plugins with today's API. Feasible: our own plugin on the selected host. Needs a Paseo feature
  (plugin-callable `openPluginSettings(pluginId, screenId, serverId)` plus a screen listing) or a fallback such as our own raw settings-document editor.

## Spike round 3: settings files, key map, registry packaging (2026-10-29, Paseo 0.13.2)
Setup: the `testenv/` harness (host W = Windows, host L = Debian 12 under WSL2, both relay + password, saved on the hub). Probe plugins and scripts were scratch only.
Row-to-key results are in `ROWS.md`.

### WP1: write `plugin-settings/<pluginId>/<settingsId>.json`, then reload
A writer plugin wrote the file of a second plugin (`defineSettings`, schema `name:string, count:int 0..10, flag:boolean`, version 1) through its own RPC; the target's server read it with `settings.read()` after `reloadPlugin`.
Results were identical on W and L.

| Case | Result |
| --- | --- |
| Valid new value (`{version:1,values:{...}}`) | PASS. `ready` with the new values. |
| Invalid value: `count:99`, wrong type, malformed JSON | PASS (rejected correctly). `invalid` with a readable error (`Too big: expected number to be <=10`, `Invalid input: expected string, received number`, JSON parse message). File is left untouched, no reset. |
| `version` higher than known (2 vs 1) | `invalid`, error `Settings were saved by a newer plugin version`. File preserved. |
| Older `version` with `migrate` | PASS. Migrated on read and persisted once (`version` rewritten to the new one). |
| File missing (never written, or deleted later) | `ready` with schema defaults, revision `"missing"`. |
| Partial `values` / unknown extra key | `ready`; defaults fill gaps, unknown keys are dropped from the values but stay in the file. |

Findings:
- **A reload is not needed to read.** `read()` hits the file on every call (no cache); the new value was visible 1.5 s after the write without a reload, and after `reloadPlugin`, `disablePlugin`+`enablePlugin` alike. Reload is only needed for plugin code that cached the values.
- **External writes do not fire `subscribe`.** The server listener only ran for the migration (a daemon-side save). Whether a connected client's `useSettings` refreshes after an external write is not testable without the app UI; the editor should call the hook's `reload()` or reopen after Apply.
- `revision` = SHA-256 of the file bytes, `"missing"` for no file. Usable for optimistic concurrency and "unchanged" detection.
- The plugin list (`listPlugins`) shows no settings state: an `invalid` document leaves the plugin `running`. The only way to learn validity is the owning plugin's own RPC; our companion can read the file but cannot validate against a private Zod schema. Paste of a settings document therefore needs "written, validity unknown" in the UI, unless the target plugin exposes a read RPC.
- There is no DaemonClient method for plugin settings (grep of the 0.13.2 client); file access through the companion is the only path.
- Plugin subprocess has `PASEO_HOME` and may write `plugin-settings/**` and `config.json`.

### WP3: Paseo registry and runtime dependency packaging
**How the registry works (0.13.x).** The registry is a GitHub repository (reviewed pins) published as static JSON: `GET <base>/index.json` and `GET <base>/plugins/<owner>/<slug>.json`; default base `https://plugins.paseo.sh`.
A record's `artifact` is the install pin, either `{kind:"npm", package, version (exact), resolved (tarball URL), integrity (sha512)}` or `{kind:"git", remote, commit (40 hex), pluginPath?}`. The daemon installs only the artifact, verifies integrity or commit, and later update checks use the registry pin, never npm latest or Git HEAD; `--ref` is rejected for registry installs.
Submission: GitHub issue form (`getpaseo/plugins`, `submit-plugin.yml`) with a public npm package or public GitHub repo/folder; a bot opens a review PR, a reviewer pins the exact version/commit and merges. npm releases get automatic bump PRs, Git bumps are manual and follow tags.

Required for a listing: `paseo-plugin.json` at the artifact root (or `pluginPath`) with `id`, `requirements.paseo`, description (npm: `package.json`, git: manifest); `OVERVIEW.md` beside it (validator rejects the strings `paseo plugin add`, `npm install`, `npm i`); at least one image URL for a plugin with UI; for npm a non-private package with a GitHub `repository` whose owner is the registry owner, and `files` that include every entry, directory, overview and asset. Runtime dependencies need a full lock with `resolved` + `integrity`: `npm-shrinkwrap.json` in the npm package, or a committed `package-lock.json` plus manifest `"build": [["npm","ci","--omit=dev","--ignore-scripts"]]` for Git. Review policy (`REVIEW.md`) reads install commands, dependencies, outbound hosts, **credential and environment reads, writes outside the plugin's own storage, `child_process`**, runtime installs (allowed only on explicit user confirmation, disclosed in the overview) and requires bundles to have their source in the repository.

**How the daemon installs.** npm artifact: isolated dir, `npm install --ignore-scripts --omit=dev` of the `resolved` URL, lockfile kept, integrity compared with the record; git artifact: clone, checkout commit, run manifest `build`. Then Paseo's own esbuild bundles `index.server.ts` with everything under `node_modules` inlined; only `@getpaseo/plugin`, its SDK entries and `zod` stay external (host-provided). `npm` must be on the target daemon's PATH for npm artifacts and `build`.

**Local reproduction.** Mock registry (static server serving `/plugins/mhm-spike/<slug>.json` and the tarballs) per host, daemon launched with `PASEO_PLUGIN_REGISTRY=http://127.0.0.1:<port>`, install via the routed `installPluginSource({source:"mhm-spike/client-p1"})`. Each installed probe then connected to its own daemon (`paseo.pid` listen + `local-credential`), listed hosts, opened a route to the peer (the other test host, saved over relay + password), created a `DaemonClient` with `createHostChannelTransport`, ran `listPlugins` and the peer plugin's RPC.

| Variant (all installed through a registry record) | W (Windows) | L (Linux) | Install time W / L | Note |
| --- | --- | --- | --- | --- |
| p1: npm artifact, `dependencies: {"@getpaseo/client":"0.13.2"}`, `npm-shrinkwrap.json` | PASS | PASS | 14.8 s / 7.3 s | `/node` and `/internal/daemon-client` resolve; reached peer in ~190-270 ms. |
| p2: same, client **0.13.0** against the 0.13.2 daemon | PASS | PASS | 13.6 s / 6.7 s | Connect, `listHosts`, `openHostRoute`, routed `listPlugins` and plugin RPC all fine. |
| p3: npm artifact, server dependency graph pre-bundled with esbuild (one 8.9 MB unminified `.cjs`, 759 KB tarball), no runtime deps | PASS | PASS | 4.5 s / 3.7 s | `zod`, `bufferutil`, `utf-8-validate` kept external. |
| g1: git artifact (commit pin, `file://` remote), committed lock + manifest `build` `npm ci` | PASS | PASS | 10.1 s / 5.8 s | Registry git record resolved to `git:<remote>` + `ref=<commit>`. |
| Negative control: directory install, no dependency declared | FAIL as expected | not run | - | `Could not resolve "@getpaseo/client/node"`: the host does not supply the client package. |

Findings and cautions:
- **Plain runtime `dependencies` works, and Paseo installs and bundles them.** No bundling step is needed on our side. Not declaring `@getpaseo/client` fails the install with a clear esbuild error.
- Packaging trap: with a `files` list, `npm pack` does **not** include `npm-shrinkwrap.json` unless it is listed. Add it to `files`, check `npm pack --dry-run`.
- Test trap: a directory plugin resolves modules from **ancestor** `node_modules`, so a test dir below a folder that has `@getpaseo/client` passes by accident. Test in a clean location.
- Test trap: `paseo daemon start` (managed) strips `PASEO_PLUGIN_REGISTRY` and the other daemon env settings; only `paseo daemon run` (deployment mode) honours it. The `host/owner/slug` form is HTTPS-only, so a local HTTP registry needs the env var.
- `@getpaseo/plugin@0.13.x` peer-depends on the exact same `@getpaseo/client` version. Type-check against the minimum (0.13.0) and ship `@getpaseo/client` as an exact runtime dependency at that version; 0.13.0 ran against 0.13.2 (not tested against a 0.13.0 daemon, none available).
- **Recommendation: p1 (exact runtime dependency + shrinkwrap/lock) over pre-bundling.** Paseo already bundles the dependency tree, the registry reviewer sees small source plus a lock (a 9 MB generated bundle needs a matching source diff and invites rejection), and the lock gives integrity for every package. Pre-bundling (p3) is the fallback if npm on targets proves unreliable: it installs in 4 s and needs no dependency resolution at install, but npm is still needed for an npm artifact; only a git artifact with a committed bundle avoids npm entirely.
- **Registry-review risk for this plugin:** it reads `local-credential` and `paseo.pid`, uses `@getpaseo/client/internal/*`, writes other plugins' settings files and `config.json`, and installs plugins on other hosts. Each needs an explicit justification in `OVERVIEW.md` (user-confirmed installs fit the runtime-install rule); acceptance by the reviewer is unknown. Raise it with the registry maintainers before building the writers.

### Open questions after round 3
Answered: settings-file write + reload (WP1); `config.patch` / reload / restart map (`ROWS.md`); `@getpaseo/client` as a runtime dependency via the registry mechanism, 0.13.0 against 0.13.2 (WP3).
Still open:
- Does a connected client's `useSettings` pick up an external file write without reload (needs the app UI)?
- Will the registry reviewer accept the credential/env reads, `config.json` and cross-plugin file writes, and the internal client entry? (Ask before implementing; fallback is documenting them in `OVERVIEW.md` or shipping the writers as a separate opt-in plugin.)
- Restart-required rows: only classified by `reloadDaemonConfig`; effect after an actual restart not exercised.
- Reload-applied keys beyond the 17 rows (`hostnames`, `cors`, `trustedProxies`, `git.*`, `app.baseUrl`, ...) are from server source only.
- Client 0.13.0 against an actual 0.13.0 daemon; 0.14 beta against the pinned client.
- Password-protected hub with real user relays, Linux hub on a real machine, macOS (unchanged).
- Bootstrapping the companion on a fresh host (install through the hub like any plugin, needs `pluginsEnabled`), "Add host" via `paseo.hosts.add` in the UI (unchanged).
