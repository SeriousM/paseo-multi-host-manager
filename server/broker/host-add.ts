import { setTimeout as sleep } from "node:timers/promises";
import { unencryptedLink } from "../../shared/connection";
import type { AddedHost, HostAddResult, hostAddRpc, HostFailure, LinkKind } from "../../shared/contracts";
import type { z } from "zod";
import { connectionWithPassword } from "./connection-password";
import { parseHostTarget } from "./daemon-client";
import type { DaemonClient } from "./daemon-client";
import { failureFromError, hostFailure } from "./failures";
import { withHostList } from "./host-list";
import { classifyLink, hostEntries } from "./hosts";
import type { OriginSession } from "./origin-session";

/** How long a call waits for the hub's first connect to a saved host before it reports `connecting`. */
export const ADD_SETTLE_MS = 10_000;
const POLL_MS = 500;

/**
 * The connection to save and its link class, checked before anything is saved: text Paseo would not accept, a
 * password the link type cannot carry, and an unencrypted link without the user's confirmation are refused.
 */
export function prepareConnection(input: { connection: string; password?: string; allowUnencrypted: boolean }): { connection: string; link: LinkKind } | HostFailure {
  let link: LinkKind;
  try {
    link = classifyLink(parseHostTarget(input.connection).description);
  } catch {
    return hostFailure("invalid_connection");
  }
  if (unencryptedLink(link) && !input.allowUnencrypted) return hostFailure("insecure_link", "unencrypted_link");
  if (!input.password) return { connection: input.connection, link };
  const connection = connectionWithPassword(input.connection, input.password);
  return connection === null ? hostFailure("invalid_connection", "password_unsupported") : { connection, link };
}

/** A daemon failure of a saved-host call; its own `invalid_connection` gets the fixed text of that code. */
export function savedHostFailure(error: unknown): HostFailure {
  const failure = failureFromError(error, "host_error");
  return failure.detail === "invalid_connection" ? hostFailure("invalid_connection") : failure;
}

/**
 * Polls the hub's directory until its connect to the saved host settled or `settleMs` passed, and reports the host as
 * the grid will show it. `fallback` describes it when the directory does not answer for it in time.
 */
export async function settleHost(client: DaemonClient, registrationId: string, fallback: { label: string; link: LinkKind }, settleMs: number): Promise<AddedHost> {
  const deadline = Date.now() + settleMs;
  for (;;) {
    const directory = await client.listHosts().catch(() => null);
    const summary = directory?.hosts.find((host) => host.registrationId === registrationId);
    const entry = directory ? hostEntries(directory).find((host) => host.registrationId === registrationId) : undefined;
    if (summary && entry && (summary.status !== "connecting" || Date.now() >= deadline)) {
      return { id: entry.id, registrationId, serverId: summary.serverId, label: entry.label, link: entry.link, status: summary.status, failure: entry.unavailable };
    }
    if (Date.now() >= deadline) return { id: registrationId, registrationId, serverId: null, ...fallback, status: "connecting", failure: null };
    await sleep(POLL_MS);
  }
}

/**
 * Saves a host in the hub daemon's directory (the `addHost` call `paseo host add` makes), with the daemon password put
 * into the connection when one is given, and waits until the hub's first connect settled. Connection and password go
 * to the daemon and nowhere else: not logged, not kept, and no result or failure carries them.
 */
export async function addHost(origin: OriginSession, home: string, input: z.output<typeof hostAddRpc.input>, settleMs = ADD_SETTLE_MS): Promise<HostAddResult> {
  const prepared = prepareConnection(input);
  if ("code" in prepared) return { ok: false, error: prepared };

  return withHostList(
    origin,
    home,
    input,
    async (client): Promise<HostAddResult> => {
      let registrationId: string;
      try {
        registrationId = (await client.addHost({ connection: prepared.connection, ...(input.label ? { label: input.label } : null) })).registrationId;
      } catch (error) {
        return { ok: false, error: savedHostFailure(error) };
      }
      return { ok: true, host: await settleHost(client, registrationId, { label: input.label || registrationId, link: prepared.link }, settleMs) };
    },
    (_hubId, failure) => ({ ok: false, error: failure.error }),
  );
}
