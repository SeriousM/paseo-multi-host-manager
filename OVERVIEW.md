# Multi-Host Manager

Shows the settings and plugins of every saved Paseo host in one grid and copies them between hosts.
Hosts are columns; host facts, daemon settings and installed plugins are rows. Copy a cell, paste it
onto one host or several, review the staged changes, then apply them.

![Hosts as columns, settings and plugins as rows](https://raw.githubusercontent.com/SeriousM/paseo-multi-host-manager/main/assets/screenshot-grid.png)

The plugin runs on one host, the hub, which already has your other hosts saved (`paseo host add`).
The hub's daemon reaches each host over the connection you saved for it, relay and password
included. The plugin holds no addresses or passwords.

## Setup

Install the plugin on the hub and on every host you want to manage. The copy on each host is the
companion: it reports the operating system, the settings Paseo can only change with a restart, and
the settings documents of other plugins. A host without it shows those rows as unavailable, and its
capabilities dialog offers to stage the install from the same source the hub was installed from.

Requires Paseo 0.13.0 or newer on every host, tested up to 0.14.0. Newer versions are marked
untested. Pre-release daemons are blocked until you allow them, and a host saved with a plain TCP
link, which sends its password unencrypted, is blocked until you allow that host.

## What you can do

- Compare host facts (version, OS, listen address, link type, worktree root, log level) and the
  runtime daemon settings: relay, MCP injection, browser tools, terminal agent hooks, auto-archive
  after merge, release idle agent runtimes (Paseo 0.14.0), append system prompt, custom providers and
  the global plugin switch.
- Copy a setting or a plugin from one host and paste it onto others.
- Install, remove, enable, disable, reload and update plugins per host, from a registry id, `npm:`
  or `git:` source.
- Pick a baseline host and see what differs on every other host, with a filter for differences only.
  The baseline lasts for the session.
- Edit other plugins' settings documents on any host, with a preview of every key that changes.
- Use a compact two-host view on narrow screens.

Nothing is written until you press Apply. Hosts are applied one after the other, the hub last.
Installs ask for a trust confirmation, removals for a destructive one. Turning off the relay or the
global plugin switch, or removing or disabling this plugin on a remote host, asks for a lockout
confirmation, because it can cut the hub's link to that host. Removing or disabling the plugin on the
hub itself is refused. Failed items stay in the queue with Retry.

After a settings document is written, the plugin cannot tell whether the target plugin accepts the
new values. It shows "written, validity unknown" and offers to reload that plugin.

## What it touches

Every capability tier lists the exact files and APIs involved. Nothing is sent anywhere except to
your own Paseo hosts, over the connection you already saved for them.

### Tier A: always on

- Reads `local-credential` and `paseo.pid` in the Paseo home of the current user, the same files the
  Paseo CLI reads, to connect to its own daemon.
- Uses `@getpaseo/client/node`, `openHostRoute` and the daemon client methods the CLI uses to list
  plugins, read config and manage plugins on saved hosts. The
  `@getpaseo/client/internal/daemon-client` import is isolated in `server/broker/daemon-client.ts`.
  This is an internal API and may change between Paseo releases.
- Installs, updates and removes plugin code on your other hosts, only for items you staged and
  confirmed.
- Never reads `hosts.json`. Connection strings and targets are never logged beyond a scheme
  classification.
- Reads `daemon.listen`, `worktrees.root` and `log.console.level` from `config.json` on each host for
  display. These need a restart, so the plugin never writes them; every other setting is changed
  through the daemon's own `config.patch` and re-read afterwards. The plugin never writes
  `config.json`.
- Reads the settings documents of other plugins in `plugin-settings/` on each host, with
  secret-looking values replaced by `<masked>` (by key name such as `token`, `password`, `dsn`,
  `connectionString`, and by value shape such as API key prefixes, bearer tokens and URLs with a user
  or password). This read needs no opt-in.
- Stores its own settings per host: the broker policy on the hub (pre-release hosts allowed, plain
  TCP hosts allowed) and the settings-write opt-in on each host.

### Tier B: plugin settings writes (off by default, per target host)

- Setting `allowPluginSettingsWrites` lets the plugin on that host write the settings documents of
  other plugins in `plugin-settings/`. Before writing it checks the document has not changed since it
  was read, keeps the previous version as a `.bak` next to it, writes atomically with mode 0600, and
  keeps masked values as the target had them.
- The opt-in lives in this plugin's own settings on the target host. Anyone who can authenticate to
  that host (its Paseo app, CLI or a saved-host connection) can switch it. The hub UI never offers a
  toggle for it, and the plugin refuses to write its own settings through the remote settings editor.
