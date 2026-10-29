Multi-host manager shows the settings and plugins of all the Paseo hosts saved on this host in one grid, and applies changes to several hosts after you confirm them.

Requires Paseo 0.13.0 or newer on the host that runs the manager. To manage another host, install the plugin there as well.

## What it touches

Every capability tier lists the exact files and APIs involved. Nothing is sent anywhere except to your own Paseo hosts, over the connection you already saved for them.

### Tier A: always on
- Reads `local-credential` and `paseo.pid` in the Paseo home of the current user, the same files the Paseo CLI reads, to connect to its own daemon.
- Uses `@getpaseo/client/node`, `openHostRoute` and the daemon client methods the CLI uses to list plugins, read config and manage plugins on saved hosts. The `@getpaseo/client/internal/daemon-client` import is isolated in `server/broker/daemon-client.ts`. This is an internal API and may change between Paseo releases.
- Never reads `hosts.json`. Connection strings and targets are never logged beyond a scheme classification.
- Reads `daemon.listen`, `worktrees.root` and `log.console.level` from `config.json` on each host for display. These need a restart, so the plugin never writes them; every other setting is changed through the daemon's own `config.patch`. The plugin never writes `config.json`.

### Tier B: plugin settings writes (off by default, per target host)
- Setting `allowPluginSettingsWrites` lets the plugin on that host write the settings documents of other plugins in `plugin-settings/`, with a backup, secret masking and a preview.

## Screenshot

Screenshot placeholder: add an image URL before submitting to the registry.
