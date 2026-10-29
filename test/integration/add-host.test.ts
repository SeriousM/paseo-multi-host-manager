import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gridLoadRpc, hostAddRpc } from "../../shared/contracts";
import type { DaemonClient } from "../../server/broker/daemon-client";
import { connectHub, enabled, PLUGIN_ID } from "./env";

// Nothing listens on this port: the saved host stays offline, so it cannot clash with W or L on the testenv hub.
const PORT = 6799;
const LABEL = "mhm-test-added";

describe.skipIf(!enabled)("add host through the hub plugin", () => {
  let hub: DaemonClient;
  const password = randomBytes(12).toString("hex");
  const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
  const add = async (input: Record<string, unknown>) => hostAddRpc.output.parse(await hub.invokePluginRpc(PLUGIN_ID, hostAddRpc.name, { ...policy, ...input }));
  const savedCount = async () => (await hub.listHosts()).hosts.length;

  beforeAll(async () => {
    hub = await connectHub();
  });
  afterAll(async () => {
    await hub?.close();
  });

  it("refuses invalid text and an unconfirmed plain tcp link without saving anything", async () => {
    const before = await savedCount();
    const invalid = await add({ connection: `paseo host add tcp://10.0.0.1:${PORT}?password=${password}` });
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid_connection" } });
    const plain = await add({ connection: `tcp://192.0.2.1:${PORT}?password=${password}` });
    expect(plain).toMatchObject({ ok: false, error: { code: "insecure_link", detail: "unencrypted_link" } });
    expect(JSON.stringify([invalid, plain])).not.toContain(password);
    expect(await savedCount()).toBe(before);
  });

  it("saves a host, shows it in grid.load, and removes it again", { timeout: 60_000 }, async () => {
    const result = await add({ connection: `tcp://127.0.0.1:${PORT}?password=${password}`, label: LABEL });
    if (!result.ok) throw new Error(`add failed: ${result.error.code}`);
    const { registrationId } = result.host;
    try {
      expect(result.host).toMatchObject({ label: LABEL, link: "loopback", serverId: null });
      expect(result.host.status).not.toBe("online");
      expect(JSON.stringify(result)).not.toContain(password);

      const grid = gridLoadRpc.output.parse(await hub.invokePluginRpc(PLUGIN_ID, gridLoadRpc.name, policy));
      const column = grid.hosts.find((host) => host.registrationId === registrationId);
      expect(column).toMatchObject({ id: registrationId, label: LABEL, link: "loopback", isHub: false, result: { ok: false } });
      expect(JSON.stringify(grid)).not.toContain(password);
    } finally {
      await hub.removeHost(registrationId);
    }
    expect((await hub.listHosts()).hosts.some((host) => host.registrationId === registrationId)).toBe(false);
  });
});
