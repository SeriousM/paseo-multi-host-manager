// The only file that imports Paseo's internal DaemonClient API. It may change between Paseo
// releases; every other module imports the client and its types from here.
import { randomUUID } from "node:crypto";
import { DaemonAuthenticationError, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Logger } from "@getpaseo/client/internal/daemon-client";
import { createHostChannelTransport, createHostClient } from "@getpaseo/client/node";
import type { HostDirectory, HostSummary } from "@getpaseo/protocol/hosts";
import type { MutableDaemonConfig, MutableDaemonConfigPatch, ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

export { DaemonAuthenticationError };
export type { DaemonClient, HostDirectory, HostSummary, MutableDaemonConfig, MutableDaemonConfigPatch, ServerInfoStatusPayload };
export type FeatureName = keyof NonNullable<ServerInfoStatusPayload["features"]>;

// The client's default logger prints connection details to the plugin log.
const silentLogger: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

async function connectOrClose(client: DaemonClient): Promise<DaemonClient> {
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

/** Connects to the hub's own daemon. `connection` is its local listen address. */
export function connectOriginClient(connection: string, localCredential: () => string | undefined): Promise<DaemonClient> {
  const client = createHostClient(connection, {
    clientId: `mhm-origin-${randomUUID()}`,
    reconnect: { enabled: false },
    localCredential,
    logger: silentLogger,
  });
  return connectOrClose(client);
}

/** Opens a route through the hub to one of its saved hosts. The caller closes the returned client. */
export async function connectRoutedClient(origin: DaemonClient, serverId: string): Promise<DaemonClient> {
  const scopeId = `mhm-${randomUUID()}`;
  const routeId = await origin.openHostRoute(serverId, scopeId);
  const client = new DaemonClient({
    url: "ws://routed-host/ws",
    clientId: scopeId,
    transportFactory: createHostChannelTransport(origin, serverId, scopeId, routeId),
    reconnect: { enabled: false },
    logger: silentLogger,
  });
  return connectOrClose(client);
}
