import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const OWN_PLUGIN_ID = "paseo-multi-host-manager";

export const consentSchema = z.object({
  allowConfigWrites: z.boolean().default(false),
  allowPluginSettingsWrites: z.boolean().default(false),
});
export type Consent = z.infer<typeof consentSchema>;

/** Values accepted per config.json path by `mhm.config.write-keys`: the reload-safe rows of ROWS.md. */
export const CONFIG_WRITE_SCHEMAS = {
  "daemon.relay.enabled": z.boolean(),
  "daemon.mcp.injectIntoAgents": z.boolean(),
  "daemon.browserTools.enabled": z.boolean(),
  "daemon.enableTerminalAgentHooks": z.boolean(),
  "daemon.autoArchiveAfterMerge": z.boolean(),
  "daemon.appendSystemPrompt": z.string(),
  "agents.providers": z.record(z.string(), z.record(z.string(), z.json())),
};
export type ConfigWritePath = keyof typeof CONFIG_WRITE_SCHEMAS;

export function isConfigWritePath(path: string): path is ConfigWritePath {
  return Object.hasOwn(CONFIG_WRITE_SCHEMAS, path);
}

/** Restart-only and live-only rows: readable through the companion, never written by it. */
export const CONFIG_READ_ONLY_PATHS = ["daemon.listen", "worktrees.root", "log.console.level", "pluginsEnabled"] as const;

export const CONFIG_READ_PATHS: readonly string[] = [...Object.keys(CONFIG_WRITE_SCHEMAS), ...CONFIG_READ_ONLY_PATHS];

export const companionErrorCodes = [
  "capability_disabled",
  "conflict",
  "not_allowed",
  "invalid_input",
  "invalid_document",
  "not_found",
] as const;
export type CompanionErrorCode = (typeof companionErrorCodes)[number];

const failureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(companionErrorCodes),
  message: z.string(),
  currentRevision: z.string().optional(),
});
export type CompanionFailure = z.infer<typeof failureSchema>;

function okOrFailure<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), ...shape }), failureSchema]);
}

// Path segments of the plugin-settings document location; also keeps `..` and separators out.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const segment = z.string().regex(SAFE_SEGMENT);

const documentRef = { pluginId: segment, settingsId: segment };

export const hostInfoRpc = defineRpc({
  name: "mhm.host.info",
  input: z.object({}),
  output: z.object({
    platform: z.string(),
    arch: z.string(),
    osRelease: z.string(),
    nodeVersion: z.string(),
    paseoHome: z.string().nullable(),
    consent: consentSchema,
  }),
});

export const configReadRpc = defineRpc({
  name: "mhm.config.read",
  input: z.object({}),
  output: z.object({ revision: z.string(), values: z.record(z.string(), z.json()), maskedPaths: z.array(z.string()) }),
});

export const configWriteKeysRpc = defineRpc({
  name: "mhm.config.write-keys",
  input: z.object({
    expectedRevision: z.string(),
    changes: z.array(z.object({ path: z.string(), value: z.json() })).min(1),
  }),
  output: okOrFailure({
    appliedPaths: z.array(z.string()),
    restartRequired: z.array(z.string()),
    reload: z.enum(["triggered", "not_available"]),
    revision: z.string(),
  }),
});

export const settingsListRpc = defineRpc({
  name: "mhm.settings.list",
  input: z.object({}),
  output: z.object({
    documents: z.array(z.object({ pluginId: z.string(), settingsId: z.string(), revision: z.string(), hasBackup: z.boolean() })),
  }),
});

export const settingsReadRpc = defineRpc({
  name: "mhm.settings.read",
  input: z.object(documentRef),
  output: okOrFailure({
    revision: z.string(),
    version: z.number().nullable(),
    values: z.json().nullable(),
    maskedPaths: z.array(z.string()),
    hasBackup: z.boolean(),
  }),
});

export const settingsWriteRpc = defineRpc({
  name: "mhm.settings.write",
  input: z.object({ ...documentRef, expectedRevision: z.string(), version: z.number().int().min(1), values: z.json() }),
  output: okOrFailure({ revision: z.string(), keptMaskedPaths: z.array(z.string()), backedUp: z.boolean() }),
});

export const settingsRestoreRpc = defineRpc({
  name: "mhm.settings.restore",
  input: z.object({ ...documentRef, expectedRevision: z.string() }),
  output: okOrFailure({ revision: z.string() }),
});
