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

/** A host as `mhm.hosts.add` reports it: the daemon's status, never its connection. */
export const addedHostSchema = z.object({
  /** The host's id in `mhm.grid.load`: its server id once the hub reached it, else the registration id. */
  id: z.string(),
  registrationId: z.string(),
  serverId: z.string().nullable(),
  label: z.string(),
  link: linkKindSchema,
  status: z.enum(["connecting", "online", "offline", "error", "disabled"]),
  /** Why the hub cannot use the host yet (wrong password, duplicate, offline); null when it is online. */
  failure: hostFailureSchema.nullable(),
});
export type AddedHost = z.infer<typeof addedHostSchema>;

/**
 * Saves a host on the hub's daemon (`paseo host add`), a direct action, not staged. `connection` goes to the daemon
 * only; it is never logged, stored by this plugin or returned, and failures carry fixed texts. A connection the hub
 * would reach unencrypted (`tcp-plain`) needs `allowUnencrypted`, else `insecure_link` with detail `unencrypted_link`;
 * one Paseo would not accept is `invalid_connection`. Nothing is saved in either case.
 * The call waits a few seconds for the hub's first connect, so `status` is usually settled.
 */
export const hostAddRpc = defineRpc({
  name: "mhm.hosts.add",
  input: brokerPolicySchema.extend({
    connection: z.string().min(1).max(8192),
    label: z.string().trim().max(80).optional(),
    allowUnencrypted: z.boolean().default(false),
  }),
  output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), host: addedHostSchema }), z.object({ ok: z.literal(false), error: hostFailureSchema })]),
});
export type HostAddInput = z.input<typeof hostAddRpc.input>;
export type HostAddResult = z.infer<typeof hostAddRpc.output>;

export const ROW_CELL_STATES = ["ok", "absent", "needs_companion", "needs_newer_paseo", "unreadable", "protected"] as const;

/** One row on one host. `value` is null unless `state` is `ok`; secret-looking strings are already masked. */
export const rowCellSchema = z.object({
  state: z.enum(ROW_CELL_STATES),
  value: z.json(),
  maskedPaths: z.array(z.string()),
});
export type RowCell = z.infer<typeof rowCellSchema>;

/**
 * Portable plugin source: never an absolute path. `installSource` (plus `ref`, if set) is what `installPlugin` accepts on
 * another host; null when it cannot be installed elsewhere (directory, credentials in the remote).
 * `pinned`: the source reproduces this host's version (npm `<pkg>@<version>`, git with `ref` = the installed commit).
 * Registry ids cannot pin, so a registry install, and an npm or git source without a known version, installs the latest.
 */
export const pluginSourceSchema = z.object({
  kind: z.enum(["registry", "npm", "git", "directory"]),
  installSource: z.string().nullable(),
  /** Git commit to pass as `installPlugin.ref`; null for every other kind or when unknown. */
  ref: z.string().nullable(),
  pinned: z.boolean(),
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
  /** Our plugin is not installed; installing it is an `installPlugin` item from the hub's own source (client/dialogs/plugin-rules.ts `companionInstall`). */
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

/**
 * Reads one settings document from a host's companion (secrets masked) for the editor or a paste.
 * `host` is a host's `id` or `registrationId` from `mhm.grid.load`, like `host` of an apply item.
 */
export const docReadRpc = defineRpc({
  name: "mhm.doc.read",
  input: brokerPolicySchema.extend(settingsReadRpc.input.shape).extend({ host: z.string().min(1) }),
  output: hostResultSchema(settingsReadRpc.output),
});

const itemBase = {
  id: z.string().min(1),
  /** A host's `id` or its `registrationId` from `mhm.grid.load` (the registration id also works before the hub ever reached the host). */
  host: z.string().min(1),
  /** Set once the UI showed the matching dialog; see the confirmation rule on `applyItemSchema`. */
  confirmed: z.boolean().optional(),
};

/**
 * One staged change. Confirmation rule: without `confirmed: true`
 * - installs and removals are rejected with `confirmation_required` (trust or destructive dialog);
 * - items that can cut the hub off from a host are rejected with `lockout_confirmation_required`: `relay` set to false on
 *   a host the hub reaches over a relay link, `pen` (pluginsEnabled) set to false on any host, and removing or disabling
 *   this plugin (`OWN_PLUGIN_ID`) on a remote host. Removing or disabling this plugin on the hub itself is always
 *   `invalid_item` with detail `self_target`.
 * An install whose source carries URL credentials is `invalid_item` with detail `credentials_in_source`.
 * `pluginId` on an install only links later items to it (see the dependency rule in server/rpc/apply.ts).
 */
export const applyItemSchema = z.discriminatedUnion("op", [
  z.object({
    ...itemBase,
    op: z.literal("setRow"),
    rowId: z.string(),
    /**
     * New value of the row. A `<masked>` placeholder is rejected (`masked_value`), except inside `prov` entries: there a
     * key whose value is `<masked>` is dropped, so the target keeps its own value for it. `prov` updates providers the
     * target already has, never adds or deletes one; ids the target lacks come back as `ignored` (`providers.<id>`).
     */
    value: z.json(),
  }),
  z.object({ ...itemBase, op: z.literal("installPlugin"), source: z.string().min(1), ref: z.string().optional(), pluginId: z.string().optional() }),
  z.object({ ...itemBase, op: z.literal("removePlugin"), pluginId: z.string().min(1) }),
  z.object({ ...itemBase, op: z.literal("setPluginEnabled"), pluginId: z.string().min(1), enabled: z.boolean() }),
  /** `checkOnly` previews the update and changes nothing. */
  z.object({ ...itemBase, op: z.literal("updatePlugin"), pluginId: z.string().min(1), checkOnly: z.boolean().optional() }),
  /** `values`: a `<masked>` placeholder keeps the value stored at the same path on the target; without one there the write fails (`invalid_input`). */
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
    /**
     * `setRow`: the patch was sent but could not be checked: the re-read failed, or (relay off over the host's relay link)
     * the link dropped before the answer came back. The next `mhm.grid.load` shows the real state.
     */
    unverified: z.boolean().optional(),
    /** `setRow` of `providers`: the providers the target has were updated, these paths (`providers.<id>`, not on the target) were not. */
    ignoredPaths: z.array(z.string()).optional(),
  }),
  /** Nothing was applied: the daemon ignored these config paths (it silently drops unknown keys), or none of the pasted providers exist on the target. */
  z.object({ status: z.literal("ignored"), paths: z.array(z.string()) }),
  z.object({ status: z.literal("failed"), error: hostFailureSchema, currentRevision: z.string().optional() }),
  /** Not run: an earlier item on the same host that it depends on did not succeed. */
  z.object({ status: z.literal("skipped"), dependsOn: z.string() }),
]);
export type ApplyOutcome = z.infer<typeof applyOutcomeSchema>;

export const applyResultSchema = z.object({ id: z.string(), host: z.string(), op: z.string(), outcome: applyOutcomeSchema });
export type ApplyResult = z.infer<typeof applyResultSchema>;

/** Input of an apply job: the policy and the staged items. Results come back in the order of `items`. */
export const applyInputSchema = brokerPolicySchema.extend({
  items: z
    .array(applyItemSchema)
    .max(500)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "item ids must be unique"),
});
export type ApplyInput = z.input<typeof applyInputSchema>;

/**
 * Starts applying staged items on the hub and returns at once. Paseo gives a plugin RPC 30 s on the daemon (60 s in the
 * client), less than one host's install may take, so the UI starts a job and polls it. There is no synchronous apply:
 * one job runs at a time and a second start while one runs is refused (`busy`).
 */
export const applyStartRpc = defineRpc({
  name: "mhm.apply.start",
  input: applyInputSchema,
  output: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), jobId: z.string() }), z.object({ ok: z.literal(false), reason: z.literal("busy") })]),
});
export type ApplyStart = z.infer<typeof applyStartRpc.output>;

/**
 * Progress of an apply job: the items settled so far (in item order) and whether it finished. `unknown`: the hub's
 * plugin has no such job (it restarted, or the job expired); a grid reload shows what changed.
 */
export const applyPollRpc = defineRpc({
  name: "mhm.apply.poll",
  input: z.object({ jobId: z.string().min(1) }),
  output: z.object({ state: z.enum(["running", "done", "unknown"]), results: z.array(applyResultSchema) }),
});
export type ApplyJob = z.infer<typeof applyPollRpc.output>;
