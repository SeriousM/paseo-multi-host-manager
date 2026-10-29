import { vi } from "vitest";
import type { Mock } from "vitest";
import type { DaemonClient, HostSummary, MutableDaemonConfig, MutableDaemonConfigPatch, PluginListItem, RoutedClient, ServerInfoStatusPayload } from "../../server/broker/daemon-client";
import { serverInfo } from "./broker-fakes";

export const ALL_FEATURES = [
  "connectedHosts",
  "hostMultiplexing",
  "plugins",
  "pluginManagement",
  "pluginSourceInstallation",
  "pluginSourceUpdates",
  "pluginSettings",
  "daemonStatusRpc",
  "relayConfig",
  "daemonConfigReload",
  "idleRuntimeCleanupSetting",
];

export function plugin(id: string, overrides: Partial<PluginListItem> = {}): PluginListItem {
  return { id, path: `C:\\abs\\path\\${id}`, enabled: true, status: "running", ...overrides };
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    const existing = target[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof existing === "object" && existing !== null) {
      merge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

/** The paths of the patch that the fake daemon "knows"; everything else is silently ignored, like the real one. */
const KNOWN_TOP_LEVEL = ["relay", "mcp", "browserTools", "enableTerminalAgentHooks", "autoArchiveAfterMerge", "idleRuntimeCleanup", "appendSystemPrompt", "pluginsEnabled", "providers"];

export interface PluginFake {
  client: DaemonClient;
  routed: RoutedClient;
  close: Mock;
  /** Every daemon call in order, as `name` or `name:arg`. */
  calls: string[];
  config: MutableDaemonConfig;
  plugins: PluginListItem[];
  /** Per-method overrides: set to make a call fail or answer differently. */
  fail: Record<string, Error | undefined>;
  rpc: Mock;
  preview: Mock;
  applyUpdates: Mock;
}

export interface PluginFakeOptions {
  info?: ServerInfoStatusPayload;
  version?: string;
  features?: string[];
  config?: Partial<MutableDaemonConfig>;
  plugins?: PluginListItem[];
  listen?: string | null;
  /** Saved hosts of the directory this daemon reports when it is the hub. */
  hosts?: HostSummary[];
  /** Shared across fakes: every call as `serverId:call`, to compare the order between hosts. */
  log?: string[];
  /** Answers of our own plugin's RPCs by method name. */
  rpc?: Record<string, unknown>;
}

/** A daemon that keeps a config and a plugin list, logs every call and ignores patch keys it does not know. */
export function pluginFake(serverId: string, options: PluginFakeOptions = {}): PluginFake {
  const info = options.info ?? serverInfo(serverId, options.version ?? "0.13.2", options.features ?? ALL_FEATURES);
  const config: MutableDaemonConfig = { mcp: { injectIntoAgents: false }, browserTools: { enabled: false }, providers: {}, metadataGeneration: { providers: [] }, autoArchiveAfterMerge: false, idleRuntimeCleanup: true, enableTerminalAgentHooks: false, appendSystemPrompt: "", pluginsEnabled: true, ...options.config };
  const plugins = options.plugins ?? [];
  const calls: string[] = [];
  const record = (entry: string) => {
    calls.push(entry);
    options.log?.push(`${serverId}:${entry}`);
  };
  const fail: Record<string, Error | undefined> = {};
  const close = vi.fn(async () => undefined);
  const rpc = vi.fn(async (_pluginId: string, method: string, input: unknown) => {
    record(`rpc:${method}`);
    const answer = options.rpc?.[method];
    return typeof answer === "function" ? answer(input) : answer;
  });
  const preview = vi.fn<(input: unknown) => Promise<unknown[]>>(async () => [{ id: "x", outcome: "current", links: [] }]);
  const applyUpdates = vi.fn<(proposals: unknown) => Promise<unknown[]>>(async () => [{ id: "x", outcome: "updated" }]);
  const step = <T>(name: string, produce: (arg: string) => T) => async (arg = ""): Promise<T> => {
    record(arg === "" ? name : `${name}:${arg}`);
    const error = fail[name];
    if (error) throw error;
    return produce(arg);
  };
  const find = (id: string) => plugins.find((p) => p.id === id) ?? plugin(id);
  const fake = {
    isConnected: true,
    close,
    listHosts: async () => ({ self: { serverId, label: "hub" }, hosts: options.hosts ?? [] }),
    getLastServerInfoMessage: () => info,
    getDaemonConfig: step("getDaemonConfig", () => ({ requestId: "r", config })),
    getDaemonStatus: step("getDaemonStatus", () => ({ requestId: "r", serverId, listen: options.listen === undefined ? "127.0.0.1:6767" : options.listen, pid: 1, nodePath: "/n", providers: [] })),
    patchDaemonConfig: async (patch: MutableDaemonConfigPatch) => {
      record(`patch:${Object.keys(patch).join(",")}`);
      if (fail.patchDaemonConfig) throw fail.patchDaemonConfig;
      const known = Object.fromEntries(Object.entries(patch).filter(([key]) => KNOWN_TOP_LEVEL.includes(key)));
      merge(config as Record<string, unknown>, known);
      return { requestId: "r", config };
    },
    listPlugins: step("listPlugins", () => plugins),
    installPluginSource: async (input: { source: string }) => {
      record(`install:${input.source}`);
      if (fail.installPluginSource) throw fail.installPluginSource;
      const installed = plugin("installed-plugin", { npm: { packageName: "keep-awake", requestedSpec: "x", version: "0.1.3", integrity: "i" } });
      plugins.push(installed);
      return installed;
    },
    removePlugin: step("remove", () => undefined),
    enablePlugin: step("enable", (id) => ({ ...find(id), enabled: true, status: "running" as const })),
    disablePlugin: step("disable", (id) => ({ ...find(id), enabled: false, status: "disabled" as const })),
    reloadPlugin: step("reload", find),
    previewPluginUpdates: async (input: unknown) => {
      record("previewUpdates");
      return preview(input);
    },
    applyPluginUpdates: async (proposals: unknown) => {
      record("applyUpdates");
      return applyUpdates(proposals);
    },
    invokePluginRpc: rpc,
  };
  const client = fake as unknown as DaemonClient;
  return { client, routed: { client, close }, close, calls, config, plugins, fail, rpc, preview, applyUpdates };
}
