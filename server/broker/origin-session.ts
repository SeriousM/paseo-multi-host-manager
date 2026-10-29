import { connectOriginClient } from "./daemon-client";
import type { DaemonClient } from "./daemon-client";
import { readHubAddress, readLocalCredential } from "./origin";

export const ORIGIN_IDLE_MS = 60_000;

/** Connects to the hub daemon recorded in `home` (its `paseo.pid` and `local-credential`). */
export function connectHubOrigin(home: string): Promise<DaemonClient> {
  const address = readHubAddress(home);
  if (!address) return Promise.reject(Object.assign(new Error("paseo.pid not found"), { code: "no_pid_file" }));
  return connectOriginClient(address.listen, () => readLocalCredential(home));
}

/**
 * The hub's own daemon connection, shared by all broker calls instead of a connect and auth per call.
 * Connects on first use, closes after `idleMs` without users, and connects again when the last connect
 * failed or the connection was lost since.
 */
export class OriginSession {
  private client: Promise<DaemonClient> | null = null;
  private users = 0;
  // Global timers: react-native's typings make setTimeout return a number here, Node's a Timeout.
  private idleTimer: NodeJS.Timeout | number | undefined;

  constructor(
    private readonly connect: () => Promise<DaemonClient>,
    private readonly idleMs = ORIGIN_IDLE_MS,
  ) {}

  async use<T>(run: (origin: DaemonClient) => Promise<T>): Promise<T> {
    this.users++;
    clearTimeout(this.idleTimer);
    try {
      const pending = this.acquire();
      let origin = await pending;
      if (!origin.isConnected) {
        // Lost since the last call (daemon restart, closed socket): replace it.
        if (this.client === pending) this.client = null;
        await origin.close().catch(() => undefined);
        origin = await this.acquire();
      }
      return await run(origin);
    } finally {
      this.users--;
      if (this.users === 0) {
        this.idleTimer = setTimeout(() => void this.close(), this.idleMs);
      }
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.idleTimer);
    const pending = this.client;
    this.client = null;
    await pending?.then((origin) => origin.close()).catch(() => undefined);
  }

  private acquire(): Promise<DaemonClient> {
    if (this.client) return this.client;
    const connecting = this.connect();
    this.client = connecting;
    // A failed connect is not kept, so the next call connects again.
    connecting.catch(() => {
      if (this.client === connecting) this.client = null;
    });
    return connecting;
  }
}
