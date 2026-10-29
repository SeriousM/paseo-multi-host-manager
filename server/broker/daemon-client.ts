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

/** Connects to the hub's own daemon. `connection` is its local listen address. */
export async function connectOriginClient(connection: string, localCredential: () => string | undefined): Promise<DaemonClient> {
  const client = createHostClient(connection, {
    clientId: `mhm-origin-${randomUUID()}`,
    reconnect: { enabled: false },
    localCredential,
    logger: silentLogger,
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export interface RoutedClient {
  client: DaemonClient;
  /** Closes the client, then the hub's route. Safe to call more than once. */
  close: () => Promise<void>;
}

/**
 * Opens a route through the hub to one of its saved hosts and connects a client over it. The caller closes
 * the result. On a connect failure, or when `signal` aborts before this returns, client and route are closed here.
 */
export async function connectRoutedClient(origin: DaemonClient, serverId: string, signal?: AbortSignal): Promise<RoutedClient> {
  signal?.throwIfAborted();
  const scopeId = `mhm-${randomUUID()}`;
  const routeId = await origin.openHostRoute(serverId, scopeId);
  const client = new DaemonClient({
    url: "ws://routed-host/ws",
    clientId: scopeId,
    transportFactory: createHostChannelTransport(origin, serverId, scopeId, routeId),
    reconnect: { enabled: false },
    logger: silentLogger,
  });
  let closing: Promise<void> | undefined;
  // The transport closes the route only once it was created; closing it here as well covers every stage.
  const close = (): Promise<void> =>
    (closing ??= client
      .close()
      .catch(() => undefined)
      .then(() => {
        try {
          origin.closeHostRoute(routeId);
        } catch {
          // The origin connection is gone, and the hub drops its routes with it.
        }
      }));
  const onAbort = () => void close();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.connect();
    signal?.throwIfAborted();
    return { client, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
