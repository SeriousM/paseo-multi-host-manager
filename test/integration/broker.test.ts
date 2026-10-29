import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostsOverviewRpc } from "../../shared/contracts";
import type { DaemonClient } from "../../server/broker/daemon-client";
import { connectHub, enabled, PLUGIN_ID, readSecrets, readState, relayPairing, HUB_HOME } from "./env";
import * as fs from "node:fs";
import * as path from "node:path";

describe.skipIf(!enabled)("broker through the hub plugin", () => {
  let hub: DaemonClient;
  let raw: unknown;

  beforeAll(async () => {
    hub = await connectHub();
    raw = await hub.invokePluginRpc(PLUGIN_ID, hostsOverviewRpc.name, {});
  });
  afterAll(async () => {
    await hub.close();
  });

  const overview = () => hostsOverviewRpc.output.parse(raw).hosts;

  it("lists hub, W and L as ok with capability snapshots", () => {
    const state = readState();
    const hosts = overview();
    expect(hosts[0]?.isHub).toBe(true);
    for (const key of ["W", "L"]) {
      const entry = state.hubHosts.find((h) => h.key === key);
      const host = hosts.find((h) => h.id === entry?.serverId);
      expect(host, key).toBeDefined();
      expect(host?.registrationId).toBe(entry?.registrationId);
      expect(host?.link).toBe("relay");
      expect(host?.result.ok).toBe(true);
    }
    for (const host of hosts.filter((h) => h.result.ok)) {
      expect(host.result.ok && host.result.snapshot.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(host.result.ok && host.result.snapshot.features).toContain("connectedHosts");
    }
    expect(hosts.find((h) => h.isHub)?.result.ok).toBe(true);
  });

  it("reports the wrong-password entry as authentication_failed", () => {
    const state = readState();
    const entry = state.hubHosts.find((h) => h.key === "W-wrongpw");
    const host = overview().find((h) => h.id === (entry?.serverId ?? entry?.registrationId));
    expect(host?.result.ok).toBe(false);
    expect(host?.result.ok === false && host.result.error.code).toBe("authentication_failed");
  });

  it("leaks no connection string, password, relay endpoint or credential", () => {
    const secrets = readSecrets();
    const pairing = relayPairing();
    const credential = fs.readFileSync(path.join(HUB_HOME, "local-credential"), "utf8").trim();
    const needles = [secrets.windows, secrets.wsl, "wrong-password", pairing.endpoint, pairing.key, credential, "password=", "relay://"];
    for (const needle of needles) expect(needle.length, "needle must not be empty").toBeGreaterThan(5);
    const serialized = JSON.stringify(raw);
    for (const needle of needles) expect(serialized.includes(needle), `response contains a secret needle (${needle.slice(0, 3)}...)`).toBe(false);
  });
});
