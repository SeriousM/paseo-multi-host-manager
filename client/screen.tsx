import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { ClipboardBar } from "./clipboard/clipboard-bar";
import { DialogHost } from "./dialogs/dialog-host";
import { StagingDrawer } from "./drawer/staging-drawer";
import { ActionBar } from "./grid/action-bar";
import { CompactView } from "./grid/compact-view";
import { GridView } from "./grid/grid-view";
import { Toolbar } from "./grid/toolbar";
import { useMhm } from "./state/hooks";

/** The screen is opened on the hub: its server is the broker for every other host. */
export function MhmScreen({ theme, layout, host }: PluginScreenProps) {
  const controller = useMhm(host.id);
  const { state, grid } = controller;
  const compact = state.view === "compact" || (state.view === "auto" && layout.compact);
  const surface = { theme, layout, controller };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <Toolbar {...surface} />
      <ClipboardBar {...surface} />
      {grid.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12, padding: 12 }}>Could not load the hosts: {grid.error}</Text> : null}
      {grid.loading && state.hosts.length === 0 ? <Loading /> : compact ? <CompactView {...surface} /> : <GridView {...surface} />}
      <ActionBar {...surface} />
      <StagingDrawer {...surface} />
      <DialogHost {...surface} />
    </View>
  );
}
