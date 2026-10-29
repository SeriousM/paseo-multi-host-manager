import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DaemonClient } from "../../server/broker/daemon-client";
import { OriginSession } from "../../server/broker/origin-session";
import { codedError, fakeClient, serverInfo } from "./broker-fakes";
import type { FakeClient } from "./broker-fakes";

const IDLE_MS = 1_000;

let clients: FakeClient[];
let connect: Mock<() => Promise<DaemonClient>>;
let session: OriginSession;

/** Each connect hands out a new fake hub client. */
function connectsNewClients() {
  connect.mockImplementation(async () => {
    const fake = fakeClient({ info: serverInfo("srv_hub", "0.13.2") });
    clients.push(fake);
    return fake.client;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
  connect = vi.fn<() => Promise<DaemonClient>>();
  connectsNewClients();
  session = new OriginSession(connect, IDLE_MS);
});

afterEach(async () => {
  await session.close();
  vi.useRealTimers();
});

const identity = async (origin: DaemonClient) => origin;

describe("OriginSession", () => {
  it("connects lazily, once, and reuses the client for later calls", async () => {
    expect(connect).not.toHaveBeenCalled();
    const first = await session.use(identity);
    const second = await session.use(identity);
    expect(second).toBe(first);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("shares one pending connect between concurrent calls", async () => {
    const [a, b] = await Promise.all([session.use(identity), session.use(identity)]);
    expect(a).toBe(b);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("closes the client after the idle time and connects again on the next call", async () => {
    await session.use(identity);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(clients[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(await session.use(identity)).toBe(clients[1].client);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("does not close while a call is still running, and restarts the idle time when it ends", async () => {
    let finish: () => void = () => undefined;
    const running = session.use(() => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
    expect(clients[0].close).not.toHaveBeenCalled();
    finish();
    await running;
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed connect: the next call connects again", async () => {
    connect.mockRejectedValueOnce(codedError("connect ECONNREFUSED", "ECONNREFUSED"));
    await expect(session.use(identity)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(await session.use(identity)).toBe(clients[0].client);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("replaces a client whose connection was lost since the last call", async () => {
    await session.use(identity);
    clients[0].disconnect();
    expect(await session.use(identity)).toBe(clients[1].client);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("close() closes the client and leaves no idle timer behind", async () => {
    await session.use(identity);
    expect(vi.getTimerCount()).toBe(1);
    await session.close();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
