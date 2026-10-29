import { z } from "zod";
import { parseHostTarget } from "./daemon-client";

const BARE_ENDPOINT = /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[0-9a-fA-F:.]+\]):[0-9]{1,5}$/;

/** The fields of Paseo's pairing offer (ConnectionOfferV2) that its relay URI carries. */
const offerSchema = z.object({
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  relay: z.object({ endpoint: z.string().min(1), useTls: z.boolean().optional() }),
  minimumSecurityMode: z.literal("protected").optional(),
});

function withParam(uri: string, password: string): string {
  const url = new URL(uri);
  url.searchParams.set("password", password);
  return url.toString();
}

/**
 * A pairing URL (`https://.../#offer=<base64url JSON>`) has no place for a password, so it becomes the relay URI Paseo
 * itself writes (serializeRelayConnectionUri in @getpaseo/protocol). TLS follows Paseo's rule for an offer without
 * `useTls`: on for port 443.
 */
function relayFromOffer(encoded: string, password: string): string {
  const offer = offerSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  const useTls = offer.relay.useTls ?? /:443$/.test(offer.relay.endpoint);
  const url = new URL(`relay://${offer.relay.endpoint}/${encodeURIComponent(offer.serverId)}`);
  url.searchParams.set("key", offer.daemonPublicKeyB64);
  if (useTls) url.searchParams.set("ssl", "true");
  if (offer.minimumSecurityMode) url.searchParams.set("security", offer.minimumSecurityMode);
  url.searchParams.set("password", password);
  return url.toString();
}

/**
 * The connection with the daemon password in it, the only place Paseo keeps a saved host's password (the `password`
 * parameter of a relay, tcp, ws(s) or ssh link; `paseo host add` has no other option for it). Null when the link type
 * cannot carry one (socket paths) or when Paseo's own parser does not read back the same target with this password,
 * so a link is never saved with a password silently dropped or its destination changed.
 * Throws for text Paseo would not accept at all.
 */
export function connectionWithPassword(connection: string, password: string): string | null {
  const text = connection.trim();
  const original = parseHostTarget(text);
  const connectAt = text.indexOf("#connect=");
  const offerAt = text.indexOf("#offer=");
  let built: string;
  try {
    if (connectAt >= 0) built = withParam(decodeURIComponent(text.slice(connectAt + "#connect=".length)), password);
    else if (offerAt >= 0) built = relayFromOffer(text.slice(offerAt + "#offer=".length), password);
    else if (/^(relay|tcp|wss?|ssh):\/\//.test(text)) built = withParam(text, password);
    else if (/^\d{1,5}$/.test(text)) built = withParam(`tcp://127.0.0.1:${text}`, password);
    else if (BARE_ENDPOINT.test(text)) built = withParam(`tcp://${text}`, password);
    else return null;
  } catch {
    return null;
  }
  const result = parseHostTarget(built);
  const sameSocket = original.kind === "socket" && result.kind === "socket" ? original.url === result.url : original.kind === result.kind;
  return result.password === password && result.description === original.description && sameSocket ? built : null;
}
