import { Text, View } from "react-native";
import { ROW_BY_ID } from "../../shared/rows";
import { Button } from "../grid/primitives";
import { findHost, formatPlugin, formatValue } from "../state/grid-model";
import type { ClipboardEntry, MhmState } from "../state/types";
import type { MhmSurfaceProps } from "../surface";

export function describeClipboard(state: Pick<MhmState, "hosts">, clip: ClipboardEntry): string {
  const source = findHost(state, clip.sourceHost)?.label ?? clip.sourceHost;
  switch (clip.kind) {
    case "row":
      return `${ROW_BY_ID[clip.rowId]?.label ?? clip.rowId}: ${formatValue(ROW_BY_ID[clip.rowId], clip.value)} from ${source}`;
    case "plugin":
      return `${clip.pluginId} ${formatPlugin(clip.plugin)} from ${source}`;
    case "doc":
      return `${clip.pluginId}/${clip.settingsId} settings from ${source}`;
  }
}

/**
 * WP8a stub of the clipboard bar (8b adds the "paste to several hosts" chips with `togglePasteTarget`,
 * `planPaste` per chip for the reason tooltip, and the `pasteTargets` action).
 */
export function ClipboardBar({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const clip = state.clipboard;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 6, minHeight: 38, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: clip ? colors.accent : colors.border }}>
      {clip ? (
        <>
          <Text numberOfLines={1} style={{ color: colors.accentForeground, backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, fontWeight: "600", fontSize: 12, flexShrink: 1 }}>
            {describeClipboard(state, clip)}
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Select a cell on another host and press Paste.</Text>
          <View style={{ flex: 1 }} />
          <Button theme={theme} label="Clear" onPress={() => dispatch({ type: "clearClipboard" })} />
        </>
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Clipboard empty. Tap a cell, press Copy, then select the same row on another host and press Paste.</Text>
      )}
    </View>
  );
}
