import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gridLoadRpc, hostAddRpc, hostRemoveRpc, hostSetPasswordRpc } from "../../shared/contracts";
import type { DaemonClient } from "../../server/broker/daemon-client";
import { connectHub, enabled, pairingLinkW, PLUGIN_ID, readSecrets, readState, updateHubHost } from "./env";

// W is saved again from its pairing link, which carries no password, the way a user pastes it. The link is the same
// daemon as the W entry, so that entry goes first (the hub refuses two registrations of one daemon); W is saved with
// its password again at the end, under a new registration id that later suites read from the state file.
describe.skipIf(!enabled)("daemon password of a saved host through the hub plugin", () => {
  let hub: DaemonClient;
  const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
  const label = () => readState().hubHosts.find((host) => host.key === "W")?.label ?? "mhm-test-W";
  const registrationOfW = () => readState().hubHosts.find((host) => host.key === "W")?.registrationId ?? "";
  const call = async (name: string, input: Record<string, unknown>) => hub.invokePluginRpc(PLUGIN_ID, name, { ...policy, ...input });
  const add = async (input: Record<string, unknown>) => hostAddRpc.output.parse(await call(hostAddRpc.name, input));
  const remove = async (registrationId: string) => hostRemoveRpc.output.parse(await call(hostRemoveRpc.name, { registrationId }));
  const setPassword = async (input: Record<string, unknown>) => hostSetPasswordRpc.output.parse(await call(hostSetPasswordRpc.name, input));

  beforeAll(async () => {
    hub = await connectHub();
  });
  afterAll(async () => {
    // Leave W saved with its password whatever happened above.
    const saved = (await hub.listHosts()).hosts.some((host) => host.registrationId === registrationOfW());
    if (!saved) {
      const restored = await add({ connection: pairingLinkW(), password: readSecrets().windows, label: label() });
      if (restored.ok) updateHubHost("W", restored.host.registrationId);
    }
    await hub?.close();
  });

  it("a pairing link without the password fails to sign in, and Set password brings the host online", { timeout: 90_000 }, async () => {
    const link = pairingLinkW();
    const password = readSecrets().windows;
    expect(await remove(registrationOfW())).toEqual({ ok: true });

    const added = await add({ connection: link, label: label() });
    if (!added.ok) throw new Error(`add failed: ${added.error.code}`);
    updateHubHost("W", added.host.registrationId);
    expect(added.host.failure?.code).toBe("authentication_failed");

    const fixed = await setPassword({ registrationId: added.host.registrationId, connection: link, password });
    if (!fixed.ok) throw new Error(`set password failed: ${fixed.error.code}/${fixed.error.detail ?? ""}`);
    expect(fixed.host).toMatchObject({ registrationId: added.host.registrationId, label: label(), status: "online", failure: null });
    expect(JSON.stringify([added, fixed])).not.toContain(password);

    const grid = gridLoadRpc.output.parse(await call(gridLoadRpc.name, {}));
    expect(grid.hosts.find((host) => host.registrationId === added.host.registrationId)?.result.ok).toBe(true);
    expect(JSON.stringify(grid)).not.toContain(password);
  });

  it("Add host with the password field saves a host that signs in at once", { timeout: 90_000 }, async () => {
    const password = readSecrets().windows;
    expect(await remove(registrationOfW())).toEqual({ ok: true });
    const added = await add({ connection: pairingLinkW(), password, label: label() });
    if (!added.ok) throw new Error(`add failed: ${added.error.code}`);
    updateHubHost("W", added.host.registrationId);
    expect(added.host).toMatchObject({ status: "online", failure: null, link: "relay" });
    expect(JSON.stringify(added)).not.toContain(password);
  });
});
