import { vi } from "vitest";
import type { Mock } from "vitest";
import type { DaemonClient, HostDirectory, HostSummary, MutableDaemonConfig, RoutedClient, ServerInfoStatusPayload } from "../../server/broker/daemon-client";

/** Strings that must never show up in results or logs. */
export const SECRETS = {
  relayEndpoint: "relay.secret-endpoint.example",
  relayKey: "daemonPublicKeyAAAA",
  password: "hunter2-password",
  tcpHost: "10.9.8.7",
  credential: "local-credential-value-123",
};

export function serverInfo(serverId: string, version: string | null, features: string[] = ["connectedHosts", "hostMultiplexing", "pluginManagement"]): ServerInfoStatusPayload {
  return {
    hostname: "test-host",
    status: "server_info",
    serverId,
    version,
    protocolVersion: 3,
    features: Object.fromEntries(features.map((name) => [name, true])),
  };
}

export function savedHost(serverId: string | null, targetDescription: string, overrides: Partial<HostSummary> = {}): HostSummary {
  return {
    registrationId: `reg_${serverId ?? "new"}`,
    serverId,
    label: serverId ? `label-${serverId}` : null,
    source: { id: "src", key: "key" },
    metadata: {},
    enabled: true,
    status: "online",
    targetDescription,
    lastOnlineAt: null,
    nextRetryAt: null,
    error: null,
    ...overrides,
  };
}

export interface FakeClient {
  client: DaemonClient;
  /** The client as connectRoutedClient returns it; its close is `close`. */
  routed: RoutedClient;
  close: Mock;
  patchDaemonConfig: Mock;
  /** Makes `isConnected` false, like a lost connection. */
  disconnect: () => void;
}

export function fakeClient(options: { info: ServerInfoStatusPayload | null; directory?: HostDirectory | Error; config?: MutableDaemonConfig }): FakeClient {
  const close = vi.fn(async () => undefined);
  const patchDaemonConfig = vi.fn(async () => ({ requestId: "r", config: options.config ?? {} }));
  const state = { connected: true };
  const fake = {
    get isConnected() {
      return state.connected;
    },
    close,
    patchDaemonConfig,
    getLastServerInfoMessage: () => options.info,
    getDaemonConfig: async () => ({ requestId: "r", config: options.config ?? {} }),
    listHosts: async () => {
      if (options.directory instanceof Error) throw options.directory;
      return options.directory ?? { self: { serverId: options.info?.serverId ?? "srv_hub", label: "hub" }, hosts: [] };
    },
  };
  const client = fake as unknown as DaemonClient;
  const disconnect = () => {
    state.connected = false;
  };
  return { client, routed: { client, close }, close, patchDaemonConfig, disconnect };
}

export function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}
