import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyRpc, docReadRpc, gridLoadRpc, hostsOverviewRpc, pingRpc } from "./shared/contracts";
import { paseoHome } from "./server/broker/origin";
import { connectHubOrigin, OriginSession } from "./server/broker/origin-session";
import { hostsOverview } from "./server/broker/overview";
import { registerCompanion } from "./server/companion";
import { applyItems } from "./server/rpc/apply";
import { readDoc } from "./server/rpc/doc";
import { loadGrid } from "./server/rpc/grid";
import { brokerSettings } from "./shared/policy";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome();
  const origin = new OriginSession(() => connectHubOrigin(home));
  server.handle(pingRpc, () => ({ ok: true as const }));
  server.handle(hostsOverviewRpc, async (policy) => ({ hosts: await hostsOverview(origin, home, policy) }));
  server.handle(gridLoadRpc, async (policy) => ({ hosts: await loadGrid(origin, home, policy) }));
  server.handle(applyRpc, async ({ items, ...policy }) => ({ results: await applyItems(origin, home, policy, items) }));
  server.handle(docReadRpc, ({ host, pluginId, settingsId, ...policy }) => readDoc(origin, home, policy, { host, pluginId, settingsId }));
  // Registered so the client can read and save it with useSettings; the server takes the policy from each call.
  server.registerSettings(brokerSettings);
  registerCompanion(server);
  return () => origin.close();
}
