import { describe, expect, it, vi } from "vitest";
import { connectRoutedClient } from "../../server/broker/daemon-client";
import type { DaemonClient } from "../../server/broker/daemon-client";

/** Just enough of an origin client for createHostChannelTransport: routes, frames and raw hub messages. */
function fakeOrigin(openHostRoute: () => Promise<string>) {
  const closeHostRoute = vi.fn();
  const sendHostFrame = vi.fn();
  const rawListeners: ((message: unknown) => void)[] = [];
  const origin = {
    openHostRoute: vi.fn(openHostRoute),
    closeHostRoute,
    cancelHostRoute: vi.fn(),
    sendHostFrame,
    subscribeRawMessages: (listener: (message: unknown) => void) => {
      rawListeners.push(listener);
      return () => undefined;
    },
    subscribeHostFrames: () => () => undefined,
    subscribeConnectionStatus: (listener: (state: { status: string }) => void) => {
      listener({ status: "connected" });
      return () => undefined;
    },
  };
  const closeRouteFromHub = (routeId: string) => {
    const message = { type: "hosts.route.closed", payload: { subscriptionId: routeId, code: "host_offline", message: "Host is offline" } };
    for (const listener of rawListeners) listener(message);
  };
  return { origin: origin as unknown as DaemonClient, closeHostRoute, sendHostFrame, closeRouteFromHub };
}

describe("connectRoutedClient", () => {
  it("closes client and route when the routed connect fails", async () => {
    const fake = fakeOrigin(async () => "route-1");
    const connecting = connectRoutedClient(fake.origin, "srv_W");
    // The hello frame went out; the fake never answers with server_info, so the handshake waits.
    await vi.waitFor(() => expect(fake.sendHostFrame).toHaveBeenCalled());
    fake.closeRouteFromHub("route-1");
    await expect(connecting).rejects.toThrow();
    expect(fake.closeHostRoute).toHaveBeenCalledWith("route-1");
  });

  it("closes a route that opens after the signal aborted, without connecting over it", async () => {
    // The executor form keeps the resolver; Promise.withResolvers is outside the configured ES2023 lib.
    let openRoute: (routeId: string) => void = () => undefined;
    const fake = fakeOrigin(() => new Promise<string>((resolve) => (openRoute = resolve)));
    const timeout = new AbortController();
    const connecting = connectRoutedClient(fake.origin, "srv_W", timeout.signal);
    timeout.abort();
    openRoute("route-2");
    await expect(connecting).rejects.toThrow();
    expect(fake.closeHostRoute).toHaveBeenCalledWith("route-2");
    expect(fake.sendHostFrame).not.toHaveBeenCalled();
  });

  it("closes client and route when the signal aborts during the handshake", async () => {
    const fake = fakeOrigin(async () => "route-3");
    const timeout = new AbortController();
    const connecting = connectRoutedClient(fake.origin, "srv_W", timeout.signal);
    await vi.waitFor(() => expect(fake.sendHostFrame).toHaveBeenCalled());
    timeout.abort();
    await expect(connecting).rejects.toThrow();
    expect(fake.closeHostRoute).toHaveBeenCalledWith("route-3");
  });

  it("does not open a route when the signal already aborted", async () => {
    const fake = fakeOrigin(async () => "route-4");
    await expect(connectRoutedClient(fake.origin, "srv_W", AbortSignal.abort())).rejects.toThrow();
    expect(fake.origin.openHostRoute).not.toHaveBeenCalled();
  });
});
