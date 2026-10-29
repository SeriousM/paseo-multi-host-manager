import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { clipFromCell, planPaste } from "../state/clipboard";
import type { PastePlan } from "../state/clipboard";
import { pluginCellView, pluginRows, rowCellView, SETTINGS_ROWS } from "../state/grid-model";
import type { CellView } from "../state/grid-model";
import type { CellRef, MhmState, StageInput } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { HubOnlyPanel } from "./hub-only-panel";
import { hubOnly } from "./layout";
import { font, TYPE } from "./palette";
import { Badge, Button } from "./primitives";

interface CompareLine {
  key: string;
  label: string;
  into: CellView;
  from: CellView;
  plan: PastePlan | null;
}

/** Settings rows that can be written plus every plugin, each compared between the two picked hosts. */
function compareLines(state: MhmState, into: string, from: string): CompareLine[] {
  const plan = (ref: CellRef) => {
    const clip = clipFromCell(state, ref);
    return clip ? planPaste(state, clip, into) : null;
  };
  const rows = SETTINGS_ROWS.filter((row) => row.write === "live").map((row) => ({
    key: `row:${row.id}`,
    label: row.label,
    into: rowCellView(state, row.id, into),
    from: rowCellView(state, row.id, from),
    plan: plan({ kind: "row", rowId: row.id, hostId: from }),
  }));
  const plugins = pluginRows(state.hosts).map((row) => ({
    key: `plugin:${row.id}`,
    label: row.id,
    into: pluginCellView(state, row, into),
    from: pluginCellView(state, row, from),
    plan: plan({ kind: "plugin", pluginId: row.id, hostId: from }),
  }));
  return [...rows, ...plugins];
}

function HostPicker({ theme, label, value, onPick, hosts }: Pick<MhmSurfaceProps, "theme"> & { label: string; value: string | null; onPick: (id: string) => void; hosts: MhmState["hosts"] }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foregroundMuted, ...font(TYPE.secondary) }}>{label}</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {hosts.map((host) => (
          <Button key={host.id} theme={theme} label={host.label} active={host.id === value} onPress={() => onPick(host.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Phone layout from the mockup: pick the host to change ("into") and the host to pull from, then pull single
 * differences or stage all of them. Uses the same paste planning as the grid.
 */
export function CompactView({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const { into, from } = state.compare;
  const lines = useMemo(() => (into && from && into !== from ? compareLines(state, into, from) : []), [state, into, from]);
  const all: StageInput[] = lines.flatMap((line) => (line.plan?.ok && !line.into.staged ? line.plan.inputs : []));
  const intoHost = state.hosts.find((host) => host.id === into);
  const fromHost = state.hosts.find((host) => host.id === from);
  const blocked = [intoHost, fromHost].find((host) => host && !host.result.ok);

  if (hubOnly(state.hosts)) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
        <HubOnlyPanel theme={theme} controller={controller} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <HostPicker theme={theme} label="Into" value={into} hosts={state.hosts} onPick={(id) => dispatch({ type: "setCompare", into: id })} />
      <HostPicker theme={theme} label="Pull from" value={from} hosts={state.hosts} onPick={(id) => dispatch({ type: "setCompare", from: id })} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Button theme={theme} variant="primary" label={`Stage all differences (${all.length})`} disabled={all.length === 0} onPress={() => dispatch({ type: "stage", inputs: all })} />
      </View>
      {blocked && !blocked.result.ok ? (
        <Text style={{ color: colors.statusDanger, ...font(TYPE.body) }}>
          {blocked.label}: {blocked.result.error.message}
        </Text>
      ) : null}
      {into === from ? <Text style={{ color: colors.foregroundMuted, ...font(TYPE.body) }}>Pick two different hosts.</Text> : null}
      {lines.map((line) => {
        const plan = line.plan;
        const [severity, status] = !plan ? (["muted", "not on source"] as const) : plan.ok ? (plan.inputs[0]?.op === "installPlugin" ? (["bad", "missing"] as const) : (["warn", "differs"] as const)) : plan.same ? (["ok", "same"] as const) : (["muted", plan.reason] as const);
        return (
          <View key={line.key} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600", ...font(TYPE.body), flexShrink: 1 }}>
                {line.label}
              </Text>
              <Badge theme={theme} label={status.length > 40 ? `${status.slice(0, 39)}...` : status} severity={severity} />
              <View style={{ flex: 1 }} />
              {plan?.ok && !line.into.staged ? (
                <Button theme={theme} variant="primary" label={plan.inputs[0]?.op === "installPlugin" ? "Install" : "Pull"} onPress={() => dispatch({ type: "stage", inputs: plan.inputs })} />
              ) : null}
            </View>
            <Text numberOfLines={1} style={{ color: line.into.staged ? colors.statusWarning : colors.foregroundMuted, ...font(TYPE.secondary) }}>
              {intoHost?.label}: {line.into.text}
            </Text>
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>
              {fromHost?.label}: {line.from.text}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
