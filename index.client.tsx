import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { MhmScreen } from "./client/screen";

const SCREEN_ID = "hosts";

function MhmSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Network" active={currentScreen?.screenId === SCREEN_ID} onPress={() => openScreen({ screenId: SCREEN_ID })} />;
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({ id: SCREEN_ID, title: "Multi-Host Manager", Component: MhmScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Multi-Host Manager", Component: MhmSidebarItem }),
    client.addCommandCenterItem({
      id: "open-multi-host-manager",
      title: "Open Multi-Host Manager",
      icon: "Network",
      keywords: ["hosts", "multi-host", "settings", "plugins", "sync", "copy"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID });
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
