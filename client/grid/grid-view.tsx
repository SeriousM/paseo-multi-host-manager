import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { pluginCellView, pluginRows, rowCellView, SETTINGS_ROWS } from "../state/grid-model";
import type { PluginRow } from "../state/grid-model";
import type { CellRef } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import type { RowDef } from "../../shared/rows";
import { GridCell } from "./cell";
import { HostHeader } from "./host-header";
import { MONO, SIZES } from "./palette";
import { Badge, Button } from "./primitives";

const WRITE_BADGE: Record<RowDef["write"], ["ok" | "muted" | "bad", string]> = {
  live: ["ok", "live"],
  readonly: ["muted", "read-only"],
  never: ["bad", "never copied"],
};

function SectionLabel({ theme, title, width }: Pick<MhmSurfaceProps, "theme"> & { title: string; width: number }) {
  return (
    <View style={{ width, height: SIZES.sectionHeight, justifyContent: "center", paddingHorizontal: 11, backgroundColor: theme.colors.surface2, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }}>
        {title}
      </Text>
    </View>
  );
}

function RowLabel({ theme, row }: Pick<MhmSurfaceProps, "theme"> & { row: RowDef }) {
  const [severity, label] = WRITE_BADGE[row.write];
  const sensitive = row.id === "relay" || row.id === "pen";
  return (
    <View style={{ height: SIZES.rowHeight, paddingHorizontal: 11, paddingVertical: 6, borderBottomWidth: 1, borderColor: theme.colors.border, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 12, flexShrink: 1 }}>
          {row.label}
        </Text>
        <Badge theme={theme} label={label} severity={severity} />
        {sensitive ? <Badge theme={theme} label="sensitive" severity="warn" /> : null}
      </View>
      <Text numberOfLines={1} style={{ ...MONO, color: theme.colors.foregroundMuted, fontSize: 10 }}>
        {row.path ?? "not exposed"}
        {row.hostSpecific ? " - host-specific" : ""}
      </Text>
    </View>
  );
}

function PluginLabel({ theme, controller, row }: Pick<MhmSurfaceProps, "theme" | "controller"> & { row: PluginRow }) {
  const installable = row.source?.installSource != null;
  return (
    <View style={{ height: SIZES.pluginRowHeight, paddingHorizontal: 11, paddingVertical: 5, borderBottomWidth: 1, borderColor: theme.colors.border, gap: 3 }}>
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 12 }}>
        {row.name && row.name !== row.id ? `${row.name} (${row.id})` : row.id}
      </Text>
      <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
        <Badge theme={theme} label={row.source?.kind ?? "?"} />
        <Button theme={theme} label="Install on..." disabled={!installable} onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "install", pluginId: row.id, hostId: null } })} />
        <Button theme={theme} label="Remove from..." onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "remove", pluginId: row.id, hostId: null } })} />
      </View>
    </View>
  );
}

/**
 * Wide layout: hosts as columns (hub first), settings rows then plugin rows. The label column stays put while the
 * host columns scroll horizontally; both scroll vertically together. Row heights are fixed so the two sides line up.
 */
export function GridView({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const plugins = useMemo(() => pluginRows(state.hosts), [state.hosts]);
  const width = state.hosts.length * SIZES.columnWidth;
  const select = (ref: CellRef) => dispatch({ type: "select", ref });

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: "row" }}>
      <View style={{ width: SIZES.labelWidth, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
        <View style={{ height: SIZES.headerHeight, borderBottomWidth: 1, borderColor: colors.border, padding: 9, justifyContent: "flex-end" }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Tap a cell to copy or paste. Tap a host for its capabilities.</Text>
        </View>
        <SectionLabel theme={theme} title="HOST SETTINGS" width={SIZES.labelWidth} />
        {SETTINGS_ROWS.map((row) => (
          <RowLabel key={row.id} theme={theme} row={row} />
        ))}
        <SectionLabel theme={theme} title={`PLUGINS (${plugins.length})`} width={SIZES.labelWidth} />
        {plugins.map((row) => (
          <PluginLabel key={row.id} theme={theme} controller={controller} row={row} />
        ))}
      </View>
      <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width }}>
        <View style={{ width }}>
          <View style={{ flexDirection: "row" }}>
            {state.hosts.map((host) => (
              <HostHeader key={host.id} theme={theme} controller={controller} host={host} width={SIZES.columnWidth} />
            ))}
          </View>
          <SectionLabel theme={theme} title="" width={width} />
          {SETTINGS_ROWS.map((row) => (
            <View key={row.id} style={{ flexDirection: "row" }}>
              {state.hosts.map((host) => (
                <GridCell key={host.id} theme={theme} view={rowCellView(state, row.id, host.id)} width={SIZES.columnWidth} height={SIZES.rowHeight} onSelect={select} />
              ))}
            </View>
          ))}
          <SectionLabel theme={theme} title="" width={width} />
          {plugins.map((row) => (
            <View key={row.id} style={{ flexDirection: "row" }}>
              {state.hosts.map((host) => (
                <GridCell key={host.id} theme={theme} view={pluginCellView(state, row, host.id)} width={SIZES.columnWidth} height={SIZES.pluginRowHeight} onSelect={select} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
