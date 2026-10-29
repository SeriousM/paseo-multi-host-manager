export type RowSection = "info" | "daemon" | "protected";
/**
 * Where a row's value comes from on a host.
 * - `server_info`: the capability snapshot (`path` = field name).
 * - `status`: `getDaemonStatus()` (`path` = field name).
 * - `hub`: the hub's directory entry for the host (the link kind).
 * - `companion.info` / `companion.config`: our plugin on the host (`mhm.host.info` field / dotted `config.json` key of `mhm.config.read`).
 * - `config`: dotted path into the `config.get` shape, which is also the `config.patch` shape.
 * - `none`: never exposed by the daemon.
 */
export type RowSource = "server_info" | "status" | "hub" | "companion.info" | "companion.config" | "config" | "none";
/** `live`: `config.patch` applies at once. `readonly`: restart-only or not a setting. `never`: secret, never read or copied. */
export type RowWrite = "live" | "readonly" | "never";
export type RowType = "text" | "bool" | "path" | "json";

export interface RowDef {
  id: string;
  label: string;
  section: RowSection;
  source: RowSource;
  path: string | null;
  write: RowWrite;
  type: RowType;
  /** `server_info.features` flag the daemon needs for a write. */
  feature?: string;
  /** Differs per host by nature; a section paste skips it. */
  hostSpecific?: boolean;
}

/**
 * Settings rows of docs/design/ROWS.md (Paseo 0.13.2). Not here on purpose: `agents.idleRuntimeCleanup` (does not exist),
 * every other key. Restart-only rows are read-only, the plugin never writes `config.json`.
 */
export const ROWS: readonly RowDef[] = [
  { id: "ver", label: "Paseo version", section: "info", source: "server_info", path: "version", write: "readonly", type: "text" },
  { id: "osn", label: "Operating system", section: "info", source: "companion.info", path: "platform", write: "readonly", type: "text" },
  { id: "listen", label: "Listen address", section: "info", source: "status", path: "listen", write: "readonly", type: "text", hostSpecific: true },
  { id: "conn", label: "Saved connection", section: "info", source: "hub", path: "link", write: "readonly", type: "text", hostSpecific: true },
  { id: "wt", label: "Worktree root", section: "info", source: "companion.config", path: "worktrees.root", write: "readonly", type: "path", hostSpecific: true },
  { id: "log", label: "Console log level", section: "info", source: "companion.config", path: "log.console.level", write: "readonly", type: "text" },
  { id: "relay", label: "Relay enabled", section: "daemon", source: "config", path: "relay.enabled", write: "live", type: "bool", feature: "relayConfig" },
  { id: "mcp", label: "Inject Paseo MCP into agents", section: "daemon", source: "config", path: "mcp.injectIntoAgents", write: "live", type: "bool" },
  { id: "browser", label: "Browser tools", section: "daemon", source: "config", path: "browserTools.enabled", write: "live", type: "bool" },
  { id: "hooks", label: "Terminal agent hooks", section: "daemon", source: "config", path: "enableTerminalAgentHooks", write: "live", type: "bool" },
  { id: "autoarch", label: "Auto-archive after merge", section: "daemon", source: "config", path: "autoArchiveAfterMerge", write: "live", type: "bool" },
  { id: "sys", label: "Append system prompt", section: "daemon", source: "config", path: "appendSystemPrompt", write: "live", type: "text" },
  // Entries lose `command` (binary paths) and `env` (credentials) when read. A paste merges: it cannot remove providers on the target.
  { id: "prov", label: "Custom providers", section: "daemon", source: "config", path: "providers", write: "live", type: "json" },
  { id: "pen", label: "Plugins enabled (global switch)", section: "daemon", source: "config", path: "pluginsEnabled", write: "live", type: "bool" },
  { id: "pw", label: "Daemon password", section: "protected", source: "none", path: null, write: "never", type: "text" },
  { id: "rc", label: "Plugin registry credentials", section: "protected", source: "none", path: null, write: "never", type: "text" },
];

export const ROW_BY_ID: Record<string, RowDef | undefined> = Object.fromEntries(ROWS.map((row) => [row.id, row]));

/** Keys of a provider entry that are never read or copied. */
export const PROVIDER_EXCLUDED_KEYS: readonly string[] = ["command", "env"];
