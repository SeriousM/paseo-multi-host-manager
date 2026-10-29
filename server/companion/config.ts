import * as path from "node:path";
import type { z } from "zod";
import {
  CONFIG_READ_PATHS,
  CONFIG_WRITE_SCHEMAS,
  isConfigWritePath,
  type CompanionFailure,
  type configReadRpc,
  type configWriteKeysRpc,
} from "../../shared/companion-contracts";
import { maskJson, restoreMasked, type Json } from "../../shared/mask";
import { atomicWrite, failure, readBytes, revisionOf, type CompanionContext } from "./files";

type ConfigReadResult = z.output<typeof configReadRpc.output>;
type ConfigWriteInput = z.output<typeof configWriteKeysRpc.input>;
type ConfigWriteResult = Extract<z.output<typeof configWriteKeysRpc.output>, { ok: true }> | CompanionFailure;

type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPath(root: JsonObject, dotted: string): Json | undefined {
  let node: Json | undefined = root;
  for (const key of dotted.split(".")) {
    if (!isObject(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

/** Sets `dotted` below `root`, creating objects on the way. Returns false when a non-object is in the way. */
function setPath(root: JsonObject, dotted: string, value: Json): boolean {
  const keys = dotted.split(".");
  const leaf = keys.pop();
  let node = root;
  for (const key of keys) {
    const next = Object.hasOwn(node, key) ? node[key] : undefined;
    if (next === undefined) {
      const created: JsonObject = {};
      node[key] = created;
      node = created;
    } else if (isObject(next)) {
      node = next;
    } else {
      return false;
    }
  }
  if (leaf === undefined) return false;
  node[leaf] = value;
  return true;
}

function parseConfig(bytes: Buffer | null): { config: JsonObject } | { error: CompanionFailure } {
  if (bytes === null) return { config: {} };
  try {
    const parsed: Json = JSON.parse(bytes.toString("utf8"));
    if (isObject(parsed)) return { config: parsed };
    return { error: failure("invalid_document", "config.json is not a JSON object") };
  } catch {
    return { error: failure("invalid_document", "config.json is not valid JSON") };
  }
}

export function configFile(home: string): string {
  return path.join(home, "config.json");
}

/** Returns only allow-listed keys (never auth hashes or registry credentials); secret-looking strings are masked. */
export function readConfig(ctx: CompanionContext): ConfigReadResult {
  const bytes = readBytes(configFile(ctx.home));
  const parsedConfig = parseConfig(bytes);
  if ("error" in parsedConfig) return { revision: revisionOf(bytes), values: {}, maskedPaths: [] };
  const { config } = parsedConfig;
  const values: Record<string, Json> = {};
  const maskedPaths: string[] = [];
  for (const dotted of CONFIG_READ_PATHS) {
    const value = getPath(config, dotted);
    if (value === undefined) continue;
    const masked = maskJson(value);
    values[dotted] = masked.value;
    maskedPaths.push(...masked.maskedPaths.map((inner) => (inner === "" ? dotted : `${dotted}.${inner}`)));
  }
  return { revision: revisionOf(bytes), values, maskedPaths };
}

export async function writeConfigKeys(ctx: CompanionContext, input: ConfigWriteInput): Promise<ConfigWriteResult> {
  if (!(await ctx.consent()).allowConfigWrites) {
    return failure("capability_disabled", "This host has not enabled config writes (allowConfigWrites).");
  }
  const rejected = input.changes.find((change) => !isConfigWritePath(change.path));
  if (rejected) return failure("not_allowed", `Key is not writable through the companion: ${rejected.path}`);

  const file = configFile(ctx.home);
  // Re-read and compare immediately before writing; everything below is synchronous, so nothing interleaves.
  const before = readBytes(file);
  const current = revisionOf(before);
  if (current !== input.expectedRevision) {
    return failure("conflict", "config.json changed since it was read.", current);
  }
  const parsedConfig = parseConfig(before);
  if ("error" in parsedConfig) return parsedConfig.error;
  const { config } = parsedConfig;

  const appliedPaths: string[] = [];
  for (const change of input.changes) {
    if (!isConfigWritePath(change.path)) continue;
    const restored = restoreMasked(change.value, getPath(config, change.path));
    if (restored.unresolvedPaths.length > 0) {
      return failure("invalid_input", `Masked placeholder without an existing value at ${change.path}`);
    }
    const parsed = CONFIG_WRITE_SCHEMAS[change.path].safeParse(restored.value);
    if (!parsed.success) return failure("invalid_input", `Invalid value for ${change.path}: ${parsed.error.message}`);
    if (!setPath(config, change.path, restored.value)) {
      return failure("invalid_document", `config.json has a non-object where ${change.path} must go`);
    }
    appliedPaths.push(change.path);
  }

  const next = Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (before !== null) atomicWrite(`${file}.bak`, before);
  atomicWrite(file, next);
  // PaseoApi has no reload call; the caller (hub) runs reloadDaemonConfig and reads the authoritative classification.
  return { ok: true, appliedPaths, restartRequired: [], reload: "not_available", revision: revisionOf(next) };
}
