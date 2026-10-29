import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { ZodType } from "zod";
import { consentSchema, settingsListRpc, settingsReadRpc, settingsRestoreRpc, settingsWriteRpc } from "./companion-contracts";
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
  /** Saved-host registration ids the user allowed over a `tcp-plain` or `unknown` link. Registration ids are stable, server ids appear only once the hub reached a host. */
  insecureLinkRegistrationIds: z.array(z.string()).default([]),
});
export type BrokerPolicy = z.infer<typeof brokerPolicySchema>;

export const hostsOverviewRpc = defineRpc({
  name: "mhm.hosts.overview",
  input: brokerPolicySchema,
  output: z.object({
    hosts: z.array(
      z.object({
        id: z.string(),
        registrationId: z.string().nullable(),
        label: z.string(),
        link: linkKindSchema,
        isHub: z.boolean(),
        result: hostResultSchema(z.null()),
      }),
    ),
  }),
});

export const ROW_CELL_STATES = ["ok", "absent", "needs_companion", "unreadable", "protected"] as const;

/** One row on one host. `value` is null unless `state` is `ok`; secret-looking strings are already masked. */
export const rowCellSchema = z.object({
  state: z.enum(ROW_CELL_STATES),
  value: z.json(),
  maskedPaths: z.array(z.string()),
});
export type RowCell = z.infer<typeof rowCellSchema>;

/** Portable plugin source: never an absolute path. `installSource` is what `installPlugin` accepts on another host; null when it cannot be installed elsewhere (directory, credentials in the remote). */
export const pluginSourceSchema = z.object({
  kind: z.enum(["registry", "npm", "git", "directory"]),
  installSource: z.string().nullable(),
});
export type PluginSource = z.infer<typeof pluginSourceSchema>;

export const pluginStatusSchema = z.enum(["running", "disabled", "failed"]);

export const gridPluginSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** npm version or installed revision (git commit); null for directory plugins. */
  version: z.string().nullable(),
  enabled: z.boolean(),
  status: pluginStatusSchema,
  source: pluginSourceSchema,
});
export type GridPlugin = z.infer<typeof gridPluginSchema>;

/** State of our own plugin on a host. `disabled` also covers `pluginsEnabled=false`; it is not a failure. */
export const companionStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }),
  z.object({ state: z.literal("disabled") }),
  z.object({ state: z.literal("failed") }),
  z.object({
    state: z.literal("ok"),
    platform: z.string(),
    arch: z.string(),
    consent: consentSchema,
    /** Settings documents on the host (metadata only), for the editor and the document paste. */
    settingsDocuments: settingsListRpc.output.shape.documents,
  }),
]);
export type CompanionState = z.infer<typeof companionStateSchema>;

export const gridHostDataSchema = z.object({
  rows: z.record(z.string(), rowCellSchema),
  plugins: z.array(gridPluginSchema),
  companion: companionStateSchema,
});
export type GridHostData = z.infer<typeof gridHostDataSchema>;

/** Rows, plugins and companion state of the hub and every saved host. One batched call per host, all hosts in parallel. */
export const gridLoadRpc = defineRpc({
  name: "mhm.grid.load",
  input: brokerPolicySchema,
  output: z.object({
    hosts: z.array(
      z.object({
        id: z.string(),
        registrationId: z.string().nullable(),
        label: z.string(),
        link: linkKindSchema,
        isHub: z.boolean(),
        result: hostResultSchema(gridHostDataSchema),
      }),
    ),
  }),
});

/** Reads one settings document from a host's companion (secrets masked) for the editor or a paste. */
export const docReadRpc = defineRpc({
  name: "mhm.doc.read",
  input: brokerPolicySchema.extend(settingsReadRpc.input.shape).extend({ host: z.string().min(1) }),
  output: hostResultSchema(settingsReadRpc.output),
});

const itemBase = { id: z.string().min(1), host: z.string().min(1) };

/**
 * One staged change. `host` is the `id` from `mhm.grid.load`. `confirmed` must be true for installs and removals
 * (the UI shows the trust or destructive dialog first); an item without it is rejected with `confirmation_required`.
 * `pluginId` on an install only links later items to it (see the dependency rule in server/rpc/apply.ts).
 */
export const applyItemSchema = z.discriminatedUnion("op", [
  z.object({ ...itemBase, op: z.literal("setRow"), rowId: z.string(), value: z.json() }),
  z.object({ ...itemBase, op: z.literal("installPlugin"), source: z.string().min(1), ref: z.string().optional(), pluginId: z.string().optional(), confirmed: z.boolean().optional() }),
  z.object({ ...itemBase, op: z.literal("removePlugin"), pluginId: z.string().min(1), confirmed: z.boolean().optional() }),
  z.object({ ...itemBase, op: z.literal("setPluginEnabled"), pluginId: z.string().min(1), enabled: z.boolean() }),
  /** `checkOnly` previews the update and changes nothing. */
  z.object({ ...itemBase, op: z.literal("updatePlugin"), pluginId: z.string().min(1), checkOnly: z.boolean().optional() }),
  settingsWriteRpc.input.extend({ ...itemBase, op: z.literal("writeSettingsDoc") }),
  settingsRestoreRpc.input.extend({ ...itemBase, op: z.literal("restoreSettingsDoc") }),
  z.object({ ...itemBase, op: z.literal("reloadPlugin"), pluginId: z.string().min(1) }),
]);
export type ApplyItem = z.infer<typeof applyItemSchema>;

export const applyOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    /** Plugin id the daemon reported (install, update, enable/disable, reload). */
    pluginId: z.string().optional(),
    version: z.string().nullable().optional(),
    pluginStatus: pluginStatusSchema.optional(),
    /** Update: `update` only for `checkOnly`; `updated` when applied; otherwise why nothing changed. */
    updateOutcome: z.enum(["update", "updated", "current", "installed-newer", "local"]).optional(),
    /** Settings document: new revision, masked placeholders that kept the stored value, and whether a backup was made. */
    revision: z.string().optional(),
    keptMaskedPaths: z.array(z.string()).optional(),
    backedUp: z.boolean().optional(),
    /** Set after a settings document write or restore: the plugin was not asked whether it accepts the values. */
    validity: z.literal("unknown").optional(),
    /** True when a `reloadPlugin` item would make the plugin pick the document up. */
    reloadSuggested: z.boolean().optional(),
  }),
  /** The daemon took the call but did not apply these config paths (it silently ignores unknown keys). */
  z.object({ status: z.literal("ignored"), paths: z.array(z.string()) }),
  z.object({ status: z.literal("failed"), error: hostFailureSchema, currentRevision: z.string().optional() }),
  /** Not run: an earlier item on the same host that it depends on did not succeed. */
  z.object({ status: z.literal("skipped"), dependsOn: z.string() }),
]);
export type ApplyOutcome = z.infer<typeof applyOutcomeSchema>;

export const applyResultSchema = z.object({ id: z.string(), host: z.string(), op: z.string(), outcome: applyOutcomeSchema });
export type ApplyResult = z.infer<typeof applyResultSchema>;

/** Applies staged items. Results come in the order of `items`. */
export const applyRpc = defineRpc({
  name: "mhm.apply",
  input: brokerPolicySchema.extend({
    items: z
      .array(applyItemSchema)
      .max(500)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "item ids must be unique"),
  }),
  output: z.object({ results: z.array(applyResultSchema) }),
});
