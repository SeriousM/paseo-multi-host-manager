import { Text, View } from "react-native";
import { ROW_BY_ID } from "../../shared/rows";
import { planPaste } from "../state/clipboard";
import { findHost, hostData, pluginCellView, pluginRows, rowCellView } from "../state/grid-model";
import type { MhmSurfaceProps } from "../surface";
import { Button } from "./primitives";

/**
 * Replaces the mockup's hover buttons: what can be done with the selected cell. Copy, Paste (or Install here), and for
 * plugins the per-plugin menu or the install dialog. Hidden while nothing is selected.
 */
export function ActionBar({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const ref = state.selection;
  if (!ref || ref.kind === "doc") return null;
  const { colors } = theme;
  const host = findHost(state, ref.hostId);
  const row = ref.kind === "plugin" ? pluginRows(state.hosts).find((candidate) => candidate.id === ref.pluginId) : undefined;
  const view = ref.kind === "row" ? rowCellView(state, ref.rowId, ref.hostId) : row ? pluginCellView(state, row, ref.hostId) : null;
  if (!view || !host) return null;
  const title = `${ref.kind === "row" ? (ROW_BY_ID[ref.rowId]?.label ?? ref.rowId) : ref.pluginId} on ${host.label}`;
  const paste = state.clipboard ? planPaste(state, state.clipboard, ref.hostId) : null;
  const sameCell = state.clipboard && (state.clipboard.kind === ref.kind || (state.clipboard.kind === "doc" && ref.kind === "plugin"));
  const installed = ref.kind === "plugin" && hostData(host)?.plugins.some((plugin) => plugin.id === ref.pluginId);
  const staged = view.staged;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ flexShrink: 1, minWidth: 160 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600", fontSize: 12 }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          {view.unavailable ? view.unavailable.message : view.text}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      {view.copyable ? <Button theme={theme} label="Copy" onPress={() => dispatch({ type: "copy", ref })} /> : null}
      {paste?.ok && sameCell ? (
        <Button
          theme={theme}
          variant="primary"
          label={paste.inputs[0]?.op === "installPlugin" ? "Install here" : "Paste"}
          onPress={() => dispatch({ type: "paste", hostId: ref.hostId })}
        />
      ) : null}
      {paste && !paste.ok && !paste.same && sameCell ? (
        <Text numberOfLines={2} style={{ color: colors.statusWarning, fontSize: 11, maxWidth: 260 }}>
          {paste.reason}
        </Text>
      ) : null}
      {ref.kind === "plugin" && host.result.ok && installed ? (
        <Button theme={theme} label="Actions..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "pluginMenu", pluginId: ref.pluginId, hostId: ref.hostId } })} />
      ) : null}
      {ref.kind === "plugin" && host.result.ok && !installed ? (
        <Button theme={theme} label="Install..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "install", pluginId: ref.pluginId, hostId: ref.hostId } })} />
      ) : null}
      {staged && !state.applying ? <Button theme={theme} label="Unstage" onPress={() => dispatch({ type: "unstage", id: staged.item.id })} /> : null}
      <Button theme={theme} label="Close" onPress={() => dispatch({ type: "select", ref: null })} />
    </View>
  );
}
