import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pingRpc } from "./shared/contracts";
import { registerCompanion } from "./server/companion";

export default function contribute(server: PluginServerContext) {
  server.handle(pingRpc, () => ({ ok: true as const }));
  registerCompanion(server);
  return () => {};
}
