import type { LinkKind } from "./contracts";

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
const BARE_ENDPOINT = /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[0-9a-fA-F:.]+\]):[0-9]{1,5}$/;

/** Socket paths (unix://, pipe://, /path, ~/path, \\\\.\\pipe\\name) reach a daemon on this machine and have no place for a password. */
export function socketPath(input: string): boolean {
  const text = input.trim();
  return /^(unix|pipe):\/\/./.test(text) || /^[/~]./.test(text) || text.startsWith("\\\\.\\pipe\\");
}

/**
 * Link class of a connection typed into Add host, by the grammar of Paseo's parseHostTarget, so the dialog can ask for
 * the "not encrypted" confirmation before sending it. Null when the text has none of the accepted shapes. The hub checks
 * again with Paseo's own parser and its answer wins; this only decides what the dialog shows.
 */
export function connectionLink(input: string): LinkKind | null {
  const text = input.trim();
  if (text === "") return null;
  if (text.startsWith("ssh://")) return "ssh";
  if (text.startsWith("relay://") || text.includes("#connect=") || text.includes("#offer=")) return "relay";
  if (socketPath(text)) return "loopback";
  if (text.startsWith("wss://")) return "tls";
  const authority = /^(?:tcp|ws):\/\/([^/?#]+)/.exec(text)?.[1] ?? (/^\d{1,5}$/.test(text) ? `127.0.0.1:${text}` : BARE_ENDPOINT.test(text) ? text : null);
  if (authority === null) return null;
  // `tcp://` hides whether TLS is on in the saved host's description, so a non-loopback one counts as plain, as in the grid.
  return LOOPBACK_HOST.test(authority.replace(/:\d+$/, "")) ? "loopback" : "tcp-plain";
}

/** Links the hub would use without encryption it can verify: saving one needs the user's explicit confirmation. */
export function unencryptedLink(link: LinkKind): boolean {
  return link === "tcp-plain" || link === "unknown";
}
