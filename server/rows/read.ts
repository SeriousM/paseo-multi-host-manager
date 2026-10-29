import { z } from "zod";
import type { LinkKind, RowCell } from "../../shared/contracts";
import { maskJson } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { PROVIDER_EXCLUDED_KEYS, ROWS } from "../../shared/rows";
import type { RowDef } from "../../shared/rows";
import type { MutableDaemonConfig } from "../broker/daemon-client";

export interface RowInputs {
  version: string | null;
  /** `getDaemonStatus().listen`; undefined when the host has no status RPC or it failed. */
  listen: string | null | undefined;
  link: LinkKind;
  config: MutableDaemonConfig;
  /** Our plugin's `mhm.host.info` and `mhm.config.read` values; null while the companion is not usable. */
  companion: { platform: string; configValues: Record<string, Json> | "unreadable" } | null;
}

const NO_VALUE: RowCell = { state: "absent", value: null, maskedPaths: [] };

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(root: unknown, dotted: string): unknown {
  let node = root;
  for (const key of dotted.split(".")) {
    if (!plainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Provider entries lose binary paths and environment variables (credentials) before anything is shown or copied. */
function withoutProviderSecrets(providers: unknown): unknown {
  if (!plainObject(providers)) return providers;
  return Object.fromEntries(
    Object.entries(providers).map(([id, entry]) => [
      id,
      plainObject(entry) ? Object.fromEntries(Object.entries(entry).filter(([key]) => !PROVIDER_EXCLUDED_KEYS.includes(key))) : entry,
    ]),
  );
}

function cellFor(row: RowDef, inputs: RowInputs): RowCell {
  if (row.write === "never") return { state: "protected", value: null, maskedPaths: [] };
  let raw: unknown;
  switch (row.source) {
    case "server_info":
      raw = inputs.version;
      break;
    case "status":
      raw = inputs.listen;
      break;
    case "hub":
      raw = inputs.link;
      break;
    case "companion.info":
      if (!inputs.companion) return { state: "needs_companion", value: null, maskedPaths: [] };
      raw = inputs.companion.platform;
      break;
    case "companion.config":
      if (!inputs.companion) return { state: "needs_companion", value: null, maskedPaths: [] };
      if (inputs.companion.configValues === "unreadable") return { state: "unreadable", value: null, maskedPaths: [] };
      raw = row.path === null ? undefined : inputs.companion.configValues[row.path];
      break;
    case "config":
      raw = row.path === null ? undefined : valueAt(inputs.config, row.path);
      if (row.id === "prov") raw = withoutProviderSecrets(raw);
      break;
    case "none":
      return NO_VALUE;
  }
  const json = z.json().safeParse(raw);
  if (raw === undefined || raw === null || !json.success) return NO_VALUE;
  const masked = maskJson(json.data);
  return { state: "ok", value: masked.value, maskedPaths: masked.maskedPaths };
}

/** Every row of ROWS.md for one host. Secret-looking values are masked; `command` and `env` of providers are dropped. */
export function buildRows(inputs: RowInputs): Record<string, RowCell> {
  return Object.fromEntries(ROWS.map((row) => [row.id, cellFor(row, inputs)]));
}
