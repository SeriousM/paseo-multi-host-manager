import { MASK_PLACEHOLDER } from "../../shared/mask";
import { PROVIDER_EXCLUDED_KEYS, ROW_BY_ID } from "../../shared/rows";
import type { MutableDaemonConfigPatch } from "../broker/daemon-client";

export type ProvidersPatch = NonNullable<MutableDaemonConfigPatch["providers"]>;
type RowPatch = { patch: MutableDaemonConfigPatch } | { invalid: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsPlaceholder(value: unknown): boolean {
  if (value === MASK_PLACEHOLDER) return true;
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  return isPlainObject(value) && Object.values(value).some(containsPlaceholder);
}

/**
 * Drops every key whose value is MASK_PLACEHOLDER, at any depth of objects, and objects that only held such keys
 * (an empty object in a patch would read as "set to {}"). Arrays are left as they are.
 */
function withoutPlaceholderKeys(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const kept = withoutPlaceholderKeys(child);
      const emptied = isPlainObject(kept) && Object.keys(kept).length === 0 && containsPlaceholder(child);
      return child === MASK_PLACEHOLDER || emptied ? [] : [[key, kept]];
    }),
  );
}

/** A non-empty record of provider entries without the keys that are never copied. The daemon validates the entries themselves. */
function isProvidersPatch(value: unknown): value is ProvidersPatch {
  if (!isPlainObject(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) => isPlainObject(entry) && PROVIDER_EXCLUDED_KEYS.every((key) => !Object.hasOwn(entry, key)));
}

/**
 * Provider entries with every `<masked>`-valued key dropped, so the target keeps its own value for it (`config.patch`
 * merges). Entries left empty are dropped; a placeholder that cannot be dropped (inside an array) is rejected.
 */
function providersPatch(value: unknown): RowPatch {
  const providers = withoutPlaceholderKeys(value);
  if (isProvidersPatch(providers) && !containsPlaceholder(providers)) return { patch: { providers } };
  return { invalid: containsPlaceholder(value) ? "masked_value" : "wrong_value_type" };
}

/** Splits a providers patch into the entries the target already has and the ids it lacks: a paste never adds a provider. */
export function existingProvidersOnly(patch: ProvidersPatch, existing: unknown): { providers: ProvidersPatch; missing: string[] } {
  const ids = isPlainObject(existing) ? Object.keys(existing) : [];
  return {
    providers: Object.fromEntries(Object.entries(patch).filter(([id]) => ids.includes(id))),
    missing: Object.keys(patch).filter((id) => !ids.includes(id)),
  };
}

/**
 * `config.patch` body for a row, or the reason it cannot be written: unknown, read-only or protected row,
 * a value of the wrong type, or a masked placeholder (a placeholder stands for a value this host never saw;
 * only `prov` drops placeholder keys instead, see providersPatch).
 */
export function rowPatch(rowId: string, value: unknown): RowPatch {
  const row = ROW_BY_ID[rowId];
  if (!row) return { invalid: "unknown_row" };
  if (row.write !== "live") return { invalid: row.write === "never" ? "protected_row" : "read_only_row" };
  if (row.id === "prov") return providersPatch(value);
  if (containsPlaceholder(value)) return { invalid: "masked_value" };
  const wrongType = { invalid: "wrong_value_type" };
  switch (row.id) {
    case "relay":
      return typeof value === "boolean" ? { patch: { relay: { enabled: value } } } : wrongType;
    case "mcp":
      return typeof value === "boolean" ? { patch: { mcp: { injectIntoAgents: value } } } : wrongType;
    case "browser":
      return typeof value === "boolean" ? { patch: { browserTools: { enabled: value } } } : wrongType;
    case "hooks":
      return typeof value === "boolean" ? { patch: { enableTerminalAgentHooks: value } } : wrongType;
    case "autoarch":
      return typeof value === "boolean" ? { patch: { autoArchiveAfterMerge: value } } : wrongType;
    case "pen":
      return typeof value === "boolean" ? { patch: { pluginsEnabled: value } } : wrongType;
    case "sys":
      return typeof value === "string" ? { patch: { appendSystemPrompt: value } } : wrongType;
    default:
      return { invalid: "read_only_row" };
  }
}
