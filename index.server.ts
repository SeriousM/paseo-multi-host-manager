import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pingRpc } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(pingRpc, () => ({ ok: true as const }));
  return () => {};
}
