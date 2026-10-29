import { once } from "node:events";
import { unencryptedLink } from "../../shared/connection";
import type { BrokerPolicy, CapabilitySnapshot, HostResult } from "../../shared/contracts";
import { capabilitySnapshot, checkGates } from "./capabilities";
import { connectRoutedClient } from "./daemon-client";
import type { DaemonClient, FeatureName, RoutedClient } from "./daemon-client";
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

async function connectAndRun<T>(origin: DaemonClient, host: HostEntry, request: HostRequest<T>, timeout: AbortSignal): Promise<HostResult<T>> {
  if (host.isHub) return runGated(origin, request);
  let routed: RoutedClient;
  try {
    routed = await connectRoutedClient(origin, host.id, timeout);
  } catch (error) {
    return { ok: false, error: failureFromError(error, "host_offline") };
  }
  // On timeout the route closes at once, which also fails the call that is still running on it.
  const onTimeout = () => void routed.close();
  timeout.addEventListener("abort", onTimeout, { once: true });
  try {
    return await runGated(routed.client, request);
  } finally {
    timeout.removeEventListener("abort", onTimeout);
    await routed.close();
  }
}

/**
 * Calls one host through the hub's origin client. The routed client and its route live only for this call.
 * On timeout the result is `host_offline`, and the routed client and route are closed right away.
 */
export async function callHost<T>(origin: DaemonClient, host: HostEntry, request: HostRequest<T>): Promise<HostResult<T>> {
  const allowed = host.registrationId !== null && request.policy.insecureLinkRegistrationIds.includes(host.registrationId);
  if (unencryptedLink(host.link) && !allowed) {
    return { ok: false, error: hostFailure("insecure_link") };
  }
  if (host.unavailable) return { ok: false, error: host.unavailable };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), request.timeoutMs);
  const timedOut = once(timeout.signal, "abort").then((): HostResult<T> => ({ ok: false, error: hostFailure("host_offline", "timeout") }));
  try {
    return await Promise.race([connectAndRun(origin, host, request, timeout.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
