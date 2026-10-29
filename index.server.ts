import type { PluginServerContext } from "@getpaseo/plugin/server";
import { hostsOverviewRpc, pingRpc } from "./shared/contracts";
import { hostsOverview } from "./server/broker/overview";
import { paseoHome } from "./server/broker/origin";
import { registerCompanion } from "./server/companion";

export default function contribute(server: PluginServerContext) {
  server.handle(pingRpc, () => ({ ok: true as const }));
  server.handle(hostsOverviewRpc, async (policy) => ({ hosts: await hostsOverview(paseoHome(), policy) }));
  registerCompanion(server);
  return () => {};
}
