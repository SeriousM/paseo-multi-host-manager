import { Text, View } from "react-native";
import { baselineHost } from "../state/compare";
import { MINIMUM_PASEO, TESTED_VERSION } from "../state/grid-model";
import type { ViewMode } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { Button } from "./primitives";
import { font, TYPE } from "./palette";

const VIEWS: Record<ViewMode, string> = { auto: "Auto", grid: "Grid", compact: "Compact" };

/** Title, host count, supported window, the pre-release policy switch, view switch, Add host and Refresh. */
export function Toolbar({ theme, controller, compact }: Pick<MhmSurfaceProps, "theme" | "controller"> & { compact: boolean }) {
  const { state, dispatch, policy, grid } = controller;
  const { colors } = theme;
  const baseline = baselineHost(state);
  const reachable = state.hosts.filter((host) => host.result.ok).length;
  const hub = state.hosts.find((host) => host.isHub);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.foreground, ...font(TYPE.title), fontWeight: "600" }}>Multi-Host Manager</Text>
      {/* On a phone the title row keeps only the count; the hub's name and the version window are in the capabilities dialog. */}
      {hub && !compact ? <Text style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>Hub: {hub.label}</Text> : null}
      <Text style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>
        {reachable} of {state.hosts.length} hosts reachable
      </Text>
      {compact ? null : (
        <Text style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>
          Supports Paseo {MINIMUM_PASEO} to {TESTED_VERSION}
        </Text>
      )}
      {controller.policyNote ? <Text style={{ color: colors.statusWarning, ...font(TYPE.secondary) }}>{controller.policyNote}</Text> : null}
      <View style={{ flex: 1 }} />
      {baseline ? <Text style={{ color: colors.accent, ...font(TYPE.secondary) }}>Baseline: {baseline.label}</Text> : null}
      {/* The filter acts on the grid only; the compact view lists every line with its own "same" or "differs". */}
      {state.view === "compact" || (state.view === "auto" && compact) ? null : (
        <Button
          theme={theme}
          label="Only differences"
          active={state.onlyDifferences}
          disabled={!baseline}
          onPress={() => dispatch({ type: "setOnlyDifferences", on: !state.onlyDifferences })}
        />
      )}
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
      <Button theme={theme} label="Add host..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "addHost" } })} />
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
