import { Text, View } from "react-native";
import { MINIMUM_PASEO, TESTED_VERSION } from "../state/grid-model";
import type { ViewMode } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { Button } from "./primitives";

const VIEWS: Record<ViewMode, string> = { auto: "Auto", grid: "Grid", compact: "Compact" };

/** Title, host count, supported window, the pre-release policy switch, view switch and Refresh. */
export function Toolbar({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch, policy, grid } = controller;
  const { colors } = theme;
  const reachable = state.hosts.filter((host) => host.result.ok).length;
  const hub = state.hosts.find((host) => host.isHub);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Multi-Host Manager</Text>
      {hub ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Hub: {hub.label}</Text> : null}
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
        {reachable} of {state.hosts.length} hosts reachable
      </Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
        Supports Paseo {MINIMUM_PASEO} to {TESTED_VERSION}
      </Text>
      {controller.policyNote ? <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{controller.policyNote}</Text> : null}
      <View style={{ flex: 1 }} />
      <Button
        theme={theme}
        label={policy.allowPrerelease ? "Pre-release hosts: allowed" : "Pre-release hosts: blocked"}
        active={policy.allowPrerelease}
        onPress={() => void controller.savePolicy({ ...policy, allowPrerelease: !policy.allowPrerelease })}
      />
      <View style={{ flexDirection: "row", gap: 2 }}>
        {(Object.keys(VIEWS) as ViewMode[]).map((view) => (
          <Button key={view} theme={theme} label={VIEWS[view]} active={state.view === view} onPress={() => dispatch({ type: "setView", view })} />
        ))}
      </View>
      <Button theme={theme} label="Install plugin..." disabled={state.hosts.length === 0} onPress={() => dispatch({ type: "openDialog", dialog: { kind: "install", pluginId: "", hostId: null } })} />
      <Button theme={theme} label={grid.refreshing ? "Refreshing..." : "Refresh"} disabled={grid.refreshing}
        onPress={() => {
          dispatch({ type: "clearUpdateChecks" });
          grid.refresh();
        }}
      />
    </View>
  );
}
