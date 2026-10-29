import { isDeepStrictEqual } from "node:util";
import type { DaemonClient, MutableDaemonConfigPatch } from "./daemon-client";

export interface PatchVerification {
  /** Dotted leaf paths whose re-read value equals the patched value. */
  applied: string[];
  /** Leaf paths the daemon did not take over (it silently ignores unknown keys). */
  ignored: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leafPaths(value: Record<string, unknown>, prefix: string[] = []): string[][] {
  return Object.entries(value).flatMap(([key, child]) =>
    isPlainObject(child) && Object.keys(child).length > 0 ? leafPaths(child, [...prefix, key]) : [[...prefix, key]],
  );
}

function valueAt(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Applies `config.patch`, then re-reads the config and reports which leaves actually changed to the patched value. */
export async function patchConfigVerified(client: DaemonClient, patch: MutableDaemonConfigPatch): Promise<PatchVerification> {
  await client.patchDaemonConfig(patch);
  const { config } = await client.getDaemonConfig();
  const result: PatchVerification = { applied: [], ignored: [] };
  for (const keys of leafPaths(patch)) {
    const expected = valueAt(patch, keys);
    const actual = valueAt(config, keys);
    const matches = expected === null ? actual === null || actual === undefined : isDeepStrictEqual(actual, expected);
    (matches ? result.applied : result.ignored).push(keys.join("."));
  }
  return result;
}
