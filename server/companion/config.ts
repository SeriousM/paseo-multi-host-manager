import * as path from "node:path";
import type { z } from "zod";
import { CONFIG_READ_PATHS, type CompanionFailure, type configReadRpc } from "../../shared/companion-contracts";
import { maskJson, type Json } from "../../shared/mask";
import { failure, readBytes, revisionOf, type CompanionContext } from "./files";

type ConfigReadResult = Extract<z.output<typeof configReadRpc.output>, { ok: true }> | CompanionFailure;

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

function parseConfig(bytes: Buffer | null): JsonObject | null {
  if (bytes === null) return {};
  try {
    const parsed: Json = JSON.parse(bytes.toString("utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns only allow-listed keys (never auth hashes or registry credentials); secret-looking strings are masked.
 * An unparseable file is `invalid_document`, so the UI does not show it as "keys not set".
 */
export function readConfig(ctx: CompanionContext): ConfigReadResult {
  const bytes = readBytes(path.join(ctx.home, "config.json"));
  const config = parseConfig(bytes);
  if (config === null) return failure("invalid_document", "config.json is not a JSON object", revisionOf(bytes));
  const values: Record<string, Json> = {};
  const maskedPaths: string[] = [];
  for (const dotted of CONFIG_READ_PATHS) {
    const value = getPath(config, dotted);
    if (value === undefined) continue;
    const masked = maskJson(value);
    values[dotted] = masked.value;
    maskedPaths.push(...masked.maskedPaths.map((inner) => (inner === "" ? dotted : `${dotted}.${inner}`)));
  }
  return { ok: true, revision: revisionOf(bytes), values, maskedPaths };
}
