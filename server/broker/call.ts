import { setTimeout as delay } from "node:timers/promises";
import type { BrokerPolicy, CapabilitySnapshot, HostResult } from "../../shared/contracts";
import { capabilitySnapshot, checkGates } from "./capabilities";
import { connectRoutedClient } from "./daemon-client";
import type { DaemonClient, FeatureName } from "./daemon-client";
import { failureFromError, hostFailure } from "./failures";
import type { HostEntry } from "./hosts";

export interface HostRequest<T> {
  policy: BrokerPolicy;
  requiredFeatures: readonly FeatureName[];
  timeoutMs: number;
  /** Runs all calls for one host on one connection (batch per host, not per cell). */
  run: (client: DaemonClient, snapshot: CapabilitySnapshot) => Promise<T>;
}

async function runGated<T>(client: DaemonClient, request: HostRequest<T>): Promise<HostResult<T>> {
  const info = client.getLastServerInfoMessage();
  if (!info) return { ok: false, error: hostFailure("host_offline", "no_server_info") };
  const snapshot = capabilitySnapshot(info);
  const gate = checkGates(snapshot, request.policy, request.requiredFeatures);
  if (gate) return { ok: false, error: gate, snapshot };
  try {
    return { ok: true, snapshot, value: await request.run(client, snapshot) };
  } catch (error) {
    return { ok: false, error: failureFromError(error, "host_error"), snapshot };
  }
}

async function connectAndRun<T>(origin: DaemonClient, host: HostEntry, request: HostRequest<T>): Promise<HostResult<T>> {
  if (host.isHub) return runGated(origin, request);
  let routed: DaemonClient;
  try {
    routed = await connectRoutedClient(origin, host.id);
  } catch (error) {
    return { ok: false, error: failureFromError(error, "host_offline") };
  }
  try {
    return await runGated(routed, request);
  } finally {
    await routed.close().catch(() => undefined);
  }
}

/**
 * Calls one host through the hub's origin client. The routed client lives only for this call.
 * On timeout the result is `host_offline`; a still-running call is torn down when the origin closes.
 */
export async function callHost<T>(origin: DaemonClient, host: HostEntry, request: HostRequest<T>): Promise<HostResult<T>> {
  const unverifiedLink = host.link === "tcp-plain" || host.link === "unknown";
  if (unverifiedLink && !request.policy.insecureLinkHostIds.includes(host.id)) {
    return { ok: false, error: hostFailure("insecure_link") };
  }
  if (host.unavailable) return { ok: false, error: host.unavailable };
  const timedOut: HostResult<T> = { ok: false, error: hostFailure("host_offline", "timeout") };
  const cancel = new AbortController();
  const timeout = delay(request.timeoutMs, timedOut, { signal: cancel.signal });
  timeout.catch(() => undefined);
  try {
    return await Promise.race([connectAndRun(origin, host, request), timeout]);
  } finally {
    cancel.abort();
  }
}
