import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { ROW_BY_ID } from "../../shared/rows";
import { tint } from "../grid/palette";
import { Button } from "../grid/primitives";
import { findHost, formatPlugin, formatValue } from "../state/grid-model";
import type { ClipboardEntry, MhmState } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { allOthersSelection, pasteChips } from "./paste-chips";
import type { PasteChip } from "./paste-chips";

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

/** A target host as a toggle. A host the clipboard cannot be pasted onto is disabled and shows why, in text: no tooltips. */
function HostChip({ theme, chip, onPress }: { theme: PluginTheme; chip: PasteChip; onPress: () => void }) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chip.label}: ${chip.note}`}
      accessibilityState={{ selected: chip.selected, disabled: !chip.selectable }}
      disabled={!chip.selectable}
      onPress={onPress}
      style={{
        maxWidth: 220,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderColor: chip.selected ? colors.accent : colors.border,
        backgroundColor: chip.selected ? tint(colors.accent, 0.3) : colors.surface2,
        opacity: chip.selectable ? 1 : chip.same ? 0.5 : 0.7,
      }}
    >
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: chip.selected ? "600" : "400" }}>
        {chip.label}
        {chip.tag ? ` (${chip.tag})` : ""}
      </Text>
      <Text numberOfLines={2} style={{ color: chip.selectable || chip.same ? colors.foregroundMuted : colors.statusWarning, fontSize: 10 }}>
        {chip.note}
      </Text>
    </Pressable>
  );
}

/** The copied item and its source host, "paste to several hosts" chips, and Clear. */
export function ClipboardBar({ theme, layout, controller }: Pick<MhmSurfaceProps, "theme" | "layout" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  const clip = state.clipboard;
  const padding = layout.compact ? 10 : 14;
  if (!clip) {
    return (
      <View style={{ paddingHorizontal: padding, paddingVertical: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Clipboard empty. Tap a cell, press Copy, then select the same row on another host and press Paste (or Install here).</Text>
      </View>
    );
  }
  const chips = pasteChips(state);
  const selected = chips.filter((chip) => chip.selected);
  const anySelectable = chips.some((chip) => chip.selectable);
  const everyOther = allOthersSelection(chips).length === 0 && anySelectable;

  return (
    <View style={{ gap: 6, paddingHorizontal: padding, paddingVertical: 8, backgroundColor: colors.surface1, borderBottomWidth: 1, borderColor: colors.accent }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text numberOfLines={layout.compact ? 2 : 1} style={{ flexShrink: 1, color: colors.accentForeground, backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, fontWeight: "600", fontSize: 12, overflow: "hidden" }}>
          {describeClipboard(state, clip)}
        </Text>
        <View style={{ flex: 1 }} />
        <Button theme={theme} label="Clear" onPress={() => dispatch({ type: "clearClipboard" })} />
      </View>
      {chips.length > 0 ? (
        <>
          {clip.kind === "doc" ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
              A settings document is pasted in the editor, which reads the target's document first so masked secrets keep the target's own values. Tap a host to open it.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Paste to several hosts:</Text>
              <Button
                theme={theme}
                label="All other hosts"
                active={everyOther}
                disabled={!anySelectable}
                onPress={() => dispatch({ type: "setPasteTargets", hostIds: allOthersSelection(chips) })}
              />
              <Button
                theme={theme}
                variant="primary"
                label={`Stage ${selected.length} in sequence`}
                disabled={selected.length === 0}
                onPress={() => dispatch({ type: "pasteTargets" })}
              />
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {chips.map((chip) => (
              <HostChip
                key={chip.hostId}
                theme={theme}
                chip={chip}
                onPress={() =>
                  clip.kind === "doc"
                    ? dispatch({ type: "openDialog", dialog: { kind: "editor", pluginId: clip.pluginId, settingsId: clip.settingsId, hostId: chip.hostId } })
                    : dispatch({ type: "togglePasteTarget", hostId: chip.hostId })
                }
              />
            ))}
          </View>
        </>
      ) : (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>There is no other host to paste to.</Text>
      )}
    </View>
  );
}
