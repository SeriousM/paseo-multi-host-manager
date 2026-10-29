import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { ZodType } from "zod";
import { ERROR_CODES } from "./errors";

export const pingRpc = defineRpc({
  name: "mhm.ping",
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
});

/**
 * Transport class of a saved host's connection. The connection itself is never exposed.
 * `tcp-plain` and `unknown` are blocked unless the user allows the host explicitly.
 */
export const linkKindSchema = z.enum(["relay", "ssh", "loopback", "tls", "tcp-plain", "unknown"]);
export type LinkKind = z.infer<typeof linkKindSchema>;

export const capabilitySnapshotSchema = z.object({
  serverId: z.string(),
  version: z.string().nullable(),
  protocolVersion: z.number().nullable(),
  prerelease: z.boolean(),
  features: z.array(z.string()),
});
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;

export const hostFailureSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  detail: z.string().optional(),
});
export type HostFailure = z.infer<typeof hostFailureSchema>;

export type HostResult<T> =
  | { ok: true; snapshot: CapabilitySnapshot; value: T }
  | { ok: false; error: HostFailure; snapshot?: CapabilitySnapshot };

export function hostResultSchema<T extends ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), snapshot: capabilitySnapshotSchema, value }),
    z.object({ ok: z.literal(false), error: hostFailureSchema, snapshot: capabilitySnapshotSchema.optional() }),
  ]);
}

/** Per-call policy; persisting the user's choices is up to the caller. */
export const brokerPolicySchema = z.object({
  allowPrerelease: z.boolean().default(false),
  insecureLinkHostIds: z.array(z.string()).default([]),
});
export type BrokerPolicy = z.infer<typeof brokerPolicySchema>;

export const hostsOverviewRpc = defineRpc({
  name: "mhm.hosts.overview",
  input: brokerPolicySchema,
  output: z.object({
    hosts: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        link: linkKindSchema,
        isHub: z.boolean(),
        result: hostResultSchema(z.null()),
      }),
    ),
  }),
});
