import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { compareRow, compareRowCell, comparePlugin, comparePluginCell, rowHasDifferences } from "../state/compare";
import { pluginRows, SETTINGS_ROWS, stagedFor } from "../state/grid-model";
import type { PluginRow } from "../state/grid-model";
import type { CellRef } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import type { RowDef } from "../../shared/rows";
import { GridCell } from "./cell";
import { HostHeader } from "./host-header";
import { HubOnlyPanel } from "./hub-only-panel";
import { gridLayout, hubOnly } from "./layout";
import { font, MONO, SIZES, TYPE } from "./palette";
import { Badge, Button } from "./primitives";

const WRITE_BADGE: Record<RowDef["write"], ["ok" | "muted" | "bad", string]> = {
  live: ["ok", "live"],
  readonly: ["muted", "read-only"],
  never: ["bad", "never copied"],
};

function SectionLabel({ theme, title, width }: Pick<MhmSurfaceProps, "theme"> & { title: string; width: number }) {
  return (
    <View style={{ width, height: SIZES.sectionHeight, justifyContent: "center", paddingHorizontal: 12, backgroundColor: theme.colors.surface2, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, ...font(TYPE.secondary), fontWeight: "600", letterSpacing: 0.5 }}>
        {title}
      </Text>
    </View>
  );
}

function RowLabel({ theme, row }: Pick<MhmSurfaceProps, "theme"> & { row: RowDef }) {
  const [severity, label] = WRITE_BADGE[row.write];
  const sensitive = row.id === "relay" || row.id === "pen";
  return (
    <View style={{ height: SIZES.rowHeight, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.border, gap: 4 }}>
      {/* One line each: fixed row heights keep the label column aligned with the host columns. */}
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600", ...font(TYPE.body) }}>
        {row.label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Badge theme={theme} label={label} severity={severity} />
        {sensitive ? <Badge theme={theme} label="sensitive" severity="warn" /> : null}
        <Text numberOfLines={1} style={{ ...MONO, color: theme.colors.foregroundMuted, ...font(TYPE.badge), flexShrink: 1 }}>
          {row.path ?? "not exposed"}
          {row.hostSpecific ? " - host-specific" : ""}
        </Text>
      </View>
    </View>
  );
}

function PluginLabel({ theme, controller, row }: Pick<MhmSurfaceProps, "theme" | "controller"> & { row: PluginRow }) {
  const installable = row.source?.installSource != null;
  return (
    <View style={{ height: SIZES.pluginRowHeight, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderColor: theme.colors.border, gap: 6 }}>
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600", ...font(TYPE.body) }}>
        {row.name && row.name !== row.id ? `${row.name} (${row.id})` : row.id}
      </Text>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Badge theme={theme} label={row.source?.kind ?? "?"} />
        <Button theme={theme} label="Install..." disabled={!installable} onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "install", pluginId: row.id, hostId: null } })} />
        <Button theme={theme} label="Remove..." onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "remove", pluginId: row.id, hostId: null } })} />
      </View>
    </View>
  );
}

/**
 * Wide layout: hosts as columns (hub first), settings rows then plugin rows. The label column stays put while the
 * host columns scroll horizontally; both scroll vertically together. Row heights are fixed so the two sides line up.
 * Columns share the measured width (see `gridLayout`); a hub without saved hosts gets the explanation panel beside it.
 */
export function GridView({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const [available, setAvailable] = useState(0);
  const allPlugins = useMemo(() => pluginRows(state.hosts), [state.hosts]);
  // "Only differences": rows where every comparable host equals the baseline are hidden, in both columns alike.
  const settings = state.onlyDifferences
    ? SETTINGS_ROWS.filter((row) => rowHasDifferences(state, (hostId) => compareRow(state, row.id, hostId), (hostId) => stagedFor(state, { kind: "row", rowId: row.id, hostId }) !== null))
    : SETTINGS_ROWS;
  const plugins = state.onlyDifferences
    ? allPlugins.filter((row) => rowHasDifferences(state, (hostId) => comparePlugin(state, row, hostId), (hostId) => stagedFor(state, { kind: "plugin", pluginId: row.id, hostId }) !== null))
    : allPlugins;
  const alone = hubOnly(state.hosts);
  const { columnWidth, panelWidth, contentWidth } = gridLayout(available, state.hosts.length, alone);
  const columnsWidth = columnWidth * state.hosts.length;
  const select = (ref: CellRef) => dispatch({ type: "select", ref });

  return (
    <View style={{ flex: 1 }} onLayout={(event) => setAvailable(Math.floor(event.nativeEvent.layout.width))}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexDirection: "row" }}>
        <View style={{ width: SIZES.labelWidth, borderRightWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
          <View style={{ height: SIZES.headerHeight, borderBottomWidth: 1, borderColor: colors.border, padding: 12, justifyContent: "flex-end" }}>
            <Text style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>Tap a cell to copy or paste. Tap a host to compare with it (baseline) or for its capabilities.</Text>
          </View>
          <SectionLabel theme={theme} title="HOST SETTINGS" width={SIZES.labelWidth} />
          {settings.map((row) => (
            <RowLabel key={row.id} theme={theme} row={row} />
          ))}
          <SectionLabel theme={theme} title={plugins.length === allPlugins.length ? `PLUGINS (${plugins.length})` : `PLUGINS (${plugins.length} of ${allPlugins.length})`} width={SIZES.labelWidth} />
          {plugins.map((row) => (
            <PluginLabel key={row.id} theme={theme} controller={controller} row={row} />
          ))}
        </View>
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: contentWidth, flexDirection: "row" }}>
          <View style={{ width: columnsWidth }}>
            <View style={{ flexDirection: "row" }}>
              {state.hosts.map((host) => (
                <HostHeader key={host.id} theme={theme} controller={controller} host={host} width={columnWidth} />
              ))}
            </View>
            <SectionLabel theme={theme} title="" width={columnsWidth} />
            {settings.map((row) => (
              <View key={row.id} style={{ flexDirection: "row" }}>
                {state.hosts.map((host) => (
                  <GridCell key={host.id} theme={theme} view={compareRowCell(state, row.id, host.id)} width={columnWidth} height={SIZES.rowHeight} onSelect={select} />
                ))}
              </View>
            ))}
            <SectionLabel theme={theme} title="" width={columnsWidth} />
            {plugins.map((row) => (
              <View key={row.id} style={{ flexDirection: "row" }}>
                {state.hosts.map((host) => (
                  <GridCell key={host.id} theme={theme} view={comparePluginCell(state, row, host.id)} width={columnWidth} height={SIZES.pluginRowHeight} onSelect={select} />
                ))}
              </View>
            ))}
          </View>
          {panelWidth > 0 ? (
            <View style={{ width: panelWidth, padding: 16 }}>
              <HubOnlyPanel theme={theme} controller={controller} />
            </View>
          ) : null}
        </ScrollView>
      </ScrollView>
    </View>
  );
}
