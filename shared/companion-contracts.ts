import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const OWN_PLUGIN_ID = "paseo-multi-host-manager";

export const consentSchema = z.object({
  allowPluginSettingsWrites: z.boolean().default(false),
});
export type Consent = z.infer<typeof consentSchema>;

/**
 * Restart-only rows of ROWS.md: not in `config.get`, so the companion reads them from `config.json` for display.
 * They are never written; every reload-safe key is live through the hub's `config.patch`.
 */
export const CONFIG_READ_PATHS: readonly string[] = ["daemon.listen", "worktrees.root", "log.console.level"];

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
// No trailing dot: NTFS drops it, so `x.` would alias the directory `x`.
export const SAFE_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/;
const segment = z.string().regex(SAFE_SEGMENT);

const documentRef = { pluginId: segment, settingsId: segment };

export const hostInfoRpc = defineRpc({
  name: "mhm.host.info",
  input: z.object({}),
  output: z.object({
    platform: z.string(),
    arch: z.string(),
    paseoHome: z.string().nullable(),
    consent: consentSchema,
  }),
});

export const configReadRpc = defineRpc({
  name: "mhm.config.read",
  input: z.object({}),
  output: okOrFailure({ revision: z.string(), values: z.record(z.string(), z.json()), maskedPaths: z.array(z.string()) }),
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
