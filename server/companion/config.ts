import * as path from "node:path";
import type { z } from "zod";
import { CONFIG_READ_PATHS, type configReadRpc } from "../../shared/companion-contracts";
import { maskJson, type Json } from "../../shared/mask";
import { readBytes, revisionOf, type CompanionContext } from "./files";

type ConfigReadResult = z.output<typeof configReadRpc.output>;

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

/** Returns only allow-listed keys (never auth hashes or registry credentials); secret-looking strings are masked. */
export function readConfig(ctx: CompanionContext): ConfigReadResult {
  const bytes = readBytes(path.join(ctx.home, "config.json"));
  const config = parseConfig(bytes);
  if (config === null) return { revision: revisionOf(bytes), values: {}, maskedPaths: [] };
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
