import { connectionLink, unencryptedLink } from "../../shared/connection";
import type { HostFailure, LinkKind } from "../../shared/contracts";
import type { Severity } from "../grid/palette";
import { failureText } from "../state/failure-text";

export const LABEL_MAX = 80;

export interface AddHostForm {
  connection: string;
  label: string;
  /** The "I understand this link is not encrypted" checkbox. */
  unencryptedConfirmed: boolean;
  /** The hub refused this text as unencrypted, so the checkbox shows whatever the local hint said. */
  hubAskedConfirm: boolean;
}

export interface AddHostView {
  link: LinkKind | null;
  /** What the typed connection is, or why it cannot be added. Never repeats the connection. */
  note: string;
  severity: Severity;
  /** Show the "not encrypted" checkbox. */
  needsConfirm: boolean;
  canAdd: boolean;
}

const LINK_NOTE: Record<LinkKind, [Severity, string]> = {
  relay: ["ok", "Relay link: end-to-end encrypted."],
  ssh: ["ok", "SSH tunnel."],
  tls: ["ok", "TLS (wss://)."],
  loopback: ["ok", "Loopback: a daemon on the hub's own machine."],
  "tcp-plain": ["warn", "Plain TCP: the hub would send the password and all traffic unencrypted."],
  unknown: ["warn", "Unknown link type: the hub cannot tell whether it is encrypted."],
};

export function addHostView(form: AddHostForm): AddHostView {
  const text = form.connection.trim();
  const labelOk = form.label.trim().length <= LABEL_MAX;
  if (text === "") return { link: null, note: "Paste a pairing link or a connection.", severity: "muted", needsConfirm: false, canAdd: false };
  if (/^paseo\s/i.test(text)) return { link: null, note: "Paste only the link, without the paseo command in front of it.", severity: "bad", needsConfirm: false, canAdd: false };
  const link = connectionLink(text);
  if (link === null) {
    return { link, note: "Not a connection Paseo accepts. Use a pairing link, relay://, tcp://host:port, ws(s)://, ssh:// or host:port.", severity: "bad", needsConfirm: false, canAdd: false };
  }
  const needsConfirm = form.hubAskedConfirm || unencryptedLink(link);
  const [severity, note] = LINK_NOTE[link];
  return {
    link,
    note: labelOk ? note : `The label is longer than ${LABEL_MAX} characters.`,
    severity: labelOk ? severity : "bad",
    needsConfirm,
    canAdd: labelOk && (!needsConfirm || form.unencryptedConfirmed),
  };
}

/** Text for a failed add. The hub's insecure-link refusal points at the checkbox instead of the capabilities dialog. */
export function addFailureText(error: HostFailure): string {
  if (error.code === "insecure_link") return "The hub would reach this host unencrypted. Tick the confirmation below to add it anyway.";
  return failureText(error);
}
