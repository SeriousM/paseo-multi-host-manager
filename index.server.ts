import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hostsOverviewRpc, pingRpc } from "./shared/contracts";
import { paseoHome } from "./server/broker/origin";
import { connectHubOrigin, OriginSession } from "./server/broker/origin-session";
import { hostsOverview } from "./server/broker/overview";
import { registerCompanion } from "./server/companion";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome();
  const origin = new OriginSession(() => connectHubOrigin(home));
  server.handle(pingRpc, () => ({ ok: true as const }));
  server.handle(hostsOverviewRpc, async (policy) => ({ hosts: await hostsOverview(origin, home, policy) }));
  registerCompanion(server);
  return () => origin.close();
}
