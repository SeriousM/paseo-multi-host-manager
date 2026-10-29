import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PlaceholderScreen } from "./client/placeholder";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "overview", title: "Multi-host manager", Component: PlaceholderScreen });
  return () => {};
}
