import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { MONO, severityColor, tint } from "../grid/palette";
import { Badge, Button } from "../grid/primitives";
import type { MhmSurfaceProps } from "../surface";
import { groupStaged, summarize } from "./staging-view";
import type { DrawerItem } from "./staging-view";

function ItemRow({ theme, layout, item, applying, onRemove }: Pick<MhmSurfaceProps, "theme" | "layout"> & { item: DrawerItem; applying: boolean; onRemove: () => void }) {
  const { colors } = theme;
  const { view, status, position } = item;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 5, borderTopWidth: 1, borderColor: tint(colors.border, 0.6) }}>
      <Text style={{ width: 18, color: colors.foregroundMuted, fontSize: 11, textAlign: "right", marginTop: 2 }}>{position}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <Text style={{ color: colors.accent, fontSize: 11, ...MONO }}>{view.kind}</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}>{view.title}</Text>
          <Badge theme={theme} label={status.label} severity={status.severity} />
        </View>
        {view.note ? (
          <Text numberOfLines={layout.compact ? 2 : undefined} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            {view.note}
          </Text>
        ) : null}
        {status.detail ? <Text style={{ color: status.severity === "ok" || status.severity === "muted" ? colors.foregroundMuted : severityColor(theme, status.severity), fontSize: 11 }}>{status.detail}</Text> : null}
      </View>
      <Button theme={theme} label="Remove" disabled={applying} onPress={onRemove} />
    </View>
  );
}

/**
 * Staged changes grouped per host in the order the server applies them. Collapsed it is one summary line with Apply;
 * expanded it lists every item with its status and outcome. Apply goes through `controller.apply`, which opens the
 * missing confirmation dialogs first.
 */
export function StagingDrawer({ theme, layout, controller }: Pick<MhmSurfaceProps, "theme" | "layout" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const [expanded, setExpanded] = useState(true);
  if (state.staged.length === 0) return null;
  const summary = summarize(state.staged, state.applying);
  const groups = groupStaged(state.staged, state.hosts);
  const padding = layout.compact ? 10 : 14;
  const idle = summary.outstanding === 0;

  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, paddingHorizontal: padding, paddingVertical: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Button theme={theme} label={expanded ? "Collapse" : "Expand"} active={expanded} onPress={() => setExpanded(!expanded)} />
        <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 12 }}>Staged changes ({summary.total})</Text>
        {summary.ok > 0 ? <Text style={{ color: colors.statusSuccess, fontSize: 11 }}>{summary.ok} applied</Text> : null}
        {summary.failed > 0 ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{summary.failed} failed</Text> : null}
        {summary.ignored > 0 ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{summary.ignored} ignored</Text> : null}
        {summary.unknown > 0 ? <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{summary.unknown} result lost</Text> : null}
        <View style={{ flex: 1 }} />
        {summary.ok > 0 ? <Button theme={theme} label="Clear applied" disabled={state.applying} onPress={() => dispatch({ type: "clearApplied" })} /> : null}
        <Button theme={theme} label="Discard all" disabled={state.applying} onPress={() => dispatch({ type: "discardAll" })} />
        <Button theme={theme} variant="primary" label={summary.applyLabel} disabled={state.applying || idle} onPress={() => void controller.apply()} />
      </View>
      {state.applyNote ? <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{state.applyNote}</Text> : null}
      {expanded ? (
        <>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Applied host by host, in this order, each over its own link. Nothing is written before Apply.</Text>
          <ScrollView style={{ maxHeight: layout.compact ? 220 : 280 }} nestedScrollEnabled>
            {groups.map((group) => (
              <View key={group.hostId} style={{ marginBottom: 6 }}>
                <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "700", marginBottom: 2 }}>{group.label}</Text>
                {group.items.map((item) => (
                  <ItemRow key={item.entry.item.id} theme={theme} layout={layout} item={item} applying={state.applying} onRemove={() => dispatch({ type: "unstage", id: item.entry.item.id })} />
                ))}
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}
