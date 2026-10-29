# Implementation plan

Decisions: companion is the same plugin, installed through the hub; distribution via the Paseo registry; no `config.json` writes (reload-safe keys go through `config.patch`); restart-only rows are read-only in v1; secrets masked by key-name and value pattern, with a per-paste preview.

## Capability tiers (registry acceptance)
Each tier is documented in `OVERVIEW.md` with the exact file/API it touches.
- **Tier A (always):** hub broker. Reads `local-credential` and `paseo.pid` (same user, same as the CLI), uses `@getpaseo/client/node`, `openHostRoute` and the DaemonClient methods the CLI uses. The `@getpaseo/client/internal/daemon-client` import is isolated in one file (`server/broker/daemon-client.ts`). The companion reads the restart-only `config.json` keys (`daemon.listen`, `worktrees.root`, `log.console.level`) for display.
- **Tier B (opt-in per target host, default off):** `allowPluginSettingsWrites` setting. The companion writes other plugins' settings documents with backup, masking and preview.
- **Removed: `config.json` writes** (former tier B, `allowConfigWrites`, `mhm.config.write-keys`). Every reload-safe key is live through `config.patch` (ROWS.md), and the restart-only rows stay read-only, so a direct file write had no remaining use and only added risk.
- Never read `hosts.json`. Never log connection strings/targets beyond a scheme classification.

## Review findings to honour
1. After a settings-document paste, show "written, validity unknown" permanently and offer `reloadPlugin` as a follow-up.
2. `config.patch` ignores unknown keys: verify every patch by re-reading.
3. Companion file writes: re-read and hash-compare immediately before writing; write temp file with mode 0600, then atomic rename.
4. Apply order: `pluginsEnabled` and `relay` first when enabling, last when disabling (disabling `pluginsEnabled` takes the companion down).
5. No rows beyond `docs/design/ROWS.md` in v1. `agents.idleRuntimeCleanup` is dropped.
6. Plugin update and remote enable/disable are untested so far; cover them in integration tests.
7. 0.13.0 daemon untested: test it in WP9 or raise the minimum to 0.13.2.
8. Mask secrets by key name (`token|key|secret|password|...`) and by value pattern (`^(sk-|ghp_|xox|AKIA)` etc.).
9. Refresh overview batched per host, not per cell (relay round trips ~0.2-1.2 s).

## Layout
Single npm package `paseo-multi-host-manager`:
`paseo-plugin.json`, `OVERVIEW.md`, `index.server.ts`, `index.client.tsx`, `server/{broker,companion,rows,rpc}/`, `client/{grid,drawer,editor,hooks}/`, `shared/{contracts,rows,errors,mask}.ts`, `test/{unit,integration}/`, `testenv/` (dev only, excluded from `files`), `docs/design/`.
Dependencies: `@getpaseo/client` exact version, `npm-shrinkwrap.json` listed in `files`.
Tests: vitest unit tests (fake DaemonClient, temp dirs cleaned in `afterEach`); integration tests run with `MHM_TESTENV=1` between `testenv/up.mjs` and `testenv/down.mjs`.

## Work packages
| WP | Goal | Deps | Done when |
|---|---|---|---|
| WP4 Scaffold | Layout above, strict tsconfig, eslint rules (no-explicit-any, consistent-type-imports, no dynamic import), vitest, `npm pack --dry-run` check, OVERVIEW.md skeleton with tier disclosures. | - | typecheck, lint, test pass; pack lists shrinkwrap; `paseo plugin add .` on hub -> running. |
| WP5 Broker | Origin client (local-credential, paseo.pid, 0.0.0.0 -> 127.0.0.1, `~/.paseo` fallback); routed client pool with dispose; `server_info` snapshot; link classification (relay/ssh/loopback/tcp-plain); prerelease and minimum-version gates; `HostResult<T>` + error enum; verify-after-patch helper. Hub column via origin client. | WP4 | Unit tests incl. "no credential string in output"; integration: overview lists W, L, wrong-password host with `authentication_failed`, hub as a column. |
| WP6 Companion | `defineSettings` with `allowPluginSettingsWrites` (default false). RPCs: `host.info`, `config.read` (restart-only keys, read-only), `settings.list/read/write/restore` (masking, revision check, atomic 0600 write, `.bak`). | WP4 | Unit tests on temp dirs; integration on W+L: restart-only keys read without secrets, opt-in off -> `capability_disabled`. |
| WP7 Rows + RPC + apply | `shared/rows.ts` from ROWS.md; Zod contracts; staging apply (sequential, per-item status, retry, backup refs); plugin install/remove/update/enable/disable. | WP5, WP6 | Integration: install keep-awake on L via hub, enable/disable, update check, remove; settings paste W -> L shows "written, validity unknown"; `pluginsEnabled=false` marks companion rows unavailable, not failed. |
| WP8 UI | 8a state model + grid; 8b clipboard bar, staging drawer, trust/destructive dialogs, capability dialog; 8c settings-document editor with secret preview and reload follow-up; compact view; registry screenshot. | WP7 contracts | Desktop + web + narrow width; every mockup action reachable; opt-in-off hosts show the reason; lint clean. |
| WP9 Matrix + release | `npm run matrix` (reach/list/RPC/install/remove/update/password/relay, `beta` mode); 0.13.0 check; final OVERVIEW.md; registry submission checklist; docs sync. | WP7, WP8 | Matrix green on 0.13.2 W+L; `npm pack` contents reviewed; testenv leaves nothing behind. |

## Questions for the Paseo maintainers (non-blocking)
a. Is `@getpaseo/client/internal/daemon-client` + `openHostRoute` acceptable for a registry plugin, or will plugin management be exposed on `PaseoApi`?
b. Is reading `local-credential` acceptable, or is there a sanctioned way for a plugin to get a DaemonClient to its own daemon?
c. Is writing other plugins' settings documents acceptable behind per-host opt-in?
d. Is "installs plugins on other hosts after user confirmation" within the runtime-install rule?
