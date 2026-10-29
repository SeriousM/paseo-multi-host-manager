import { isDeepStrictEqual } from "node:util";
import type { DaemonClient, MutableDaemonConfigPatch } from "./daemon-client";

export interface PatchVerification {
  /** Dotted leaf paths whose re-read value equals the patched value. */
  applied: string[];
  /** Leaf paths the daemon did not take over (it silently ignores unknown keys). */
  ignored: string[];
  /** The patch was accepted but the re-read failed or did not answer in time; `applied` and `ignored` are then empty. */
  unverified?: true;
}

/** A re-read that has not answered by then counts as unverified: relay off can leave the call open until the transport notices. */
export const VERIFY_TIMEOUT_MS = 10_000;

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

/**
 * Applies `config.patch`, then re-reads the config and reports which leaves actually changed to the patched value.
 * A failing patch throws; a failing re-read does not, because the patch already happened (see `unverified`).
 */
export async function patchConfigVerified(client: DaemonClient, patch: MutableDaemonConfigPatch, verifyTimeoutMs = VERIFY_TIMEOUT_MS): Promise<PatchVerification> {
  await client.patchDaemonConfig(patch);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("verify timeout")), verifyTimeoutMs);
  });
  let config: unknown;
  try {
    ({ config } = await Promise.race([client.getDaemonConfig(), timeout]));
  } catch {
    return { applied: [], ignored: [], unverified: true };
  } finally {
    clearTimeout(timer);
  }
  const result: PatchVerification = { applied: [], ignored: [] };
  for (const keys of leafPaths(patch)) {
    const expected = valueAt(patch, keys);
    const actual = valueAt(config, keys);
    const matches = expected === null ? actual === null || actual === undefined : isDeepStrictEqual(actual, expected);
    (matches ? result.applied : result.ignored).push(keys.join("."));
  }
  return result;
}
