import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HubAddress {
  /** Local listen address of the hub daemon (host:port or socket path). */
  listen: string;
  serverId: string | null;
}

export function paseoHome(): string {
  return process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
}

/** Reads the address the hub daemon recorded in `paseo.pid`; wildcard binds map to loopback. */
export function readHubAddress(home: string): HubAddress | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(home, "paseo.pid"), "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("listen" in parsed) || typeof parsed.listen !== "string") return null;
  const serverId = "serverId" in parsed && typeof parsed.serverId === "string" ? parsed.serverId : null;
  return { listen: parsed.listen.replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[::\]:/, "[::1]:"), serverId };
}

/** Same-user credential the daemon writes to its home; read on every connect attempt. */
export function readLocalCredential(home: string): string | undefined {
  try {
    return fs.readFileSync(path.join(home, "local-credential"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
