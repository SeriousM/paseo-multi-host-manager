import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CompanionFailure, Consent } from "../../shared/companion-contracts";

export interface CompanionContext {
  /** $PASEO_HOME */
  home: string;
  consent: () => Promise<Consent>;
}

export const MISSING_REVISION = "missing";

/** Revision = sha256 of the file bytes, "missing" when there is no file (same as Paseo's plugin settings). */
export function revisionOf(bytes: Buffer | null): string {
  return bytes === null ? MISSING_REVISION : createHash("sha256").update(bytes).digest("hex");
}

export function readBytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Temp file with mode 0600 in the same directory, fsync, then atomic rename over the target. */
export function atomicWrite(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

export function failure(
  code: CompanionFailure["code"],
  message: string,
  currentRevision?: string,
): CompanionFailure {
  return currentRevision === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, currentRevision };
}
