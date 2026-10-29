import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import type { CellView } from "../state/grid-model";
import type { CellRef } from "../state/types";
import { MONO, severityColor, toneStyle } from "./palette";

/** One grid cell. Tap selects it; the action bar below the grid offers what can be done with the selection. */
export function GridCell({ theme, view, width, height, onSelect }: { theme: PluginTheme; view: CellView; width: number; height: number; onSelect: (ref: CellRef) => void }) {
  const { colors } = theme;
  const tone = toneStyle(theme, view.tone);
  const dim = view.unavailable !== null && view.staged === null;
  const detailColor = view.tone === "failed" ? severityColor(theme, "bad") : view.staged || view.masked || view.tone === "attention" ? severityColor(theme, "warn") : colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: view.selected }}
      onPress={() => onSelect(view.ref)}
      style={{ width, height, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: 9,
          paddingVertical: 6,
          backgroundColor: tone.backgroundColor,
          borderWidth: view.selected ? 2 : 1,
          borderColor: view.selected ? colors.accent : tone.borderColor,
          borderStyle: view.selected ? "solid" : tone.borderStyle,
          opacity: dim ? 0.5 : 1,
        }}
      >
        <Text numberOfLines={1} style={{ ...MONO, fontSize: 12, color: view.staged ? severityColor(theme, "warn") : colors.foreground }}>
          {view.text}
        </Text>
        {view.detail ? (
          <Text numberOfLines={2} style={{ fontSize: 11, color: detailColor, marginTop: 2 }}>
            {view.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
