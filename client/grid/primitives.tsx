import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text } from "react-native";
import { font, severityColor, tint, TYPE } from "./palette";
import type { Severity } from "./palette";

export function Badge({ theme, label, severity = "muted" }: { theme: PluginTheme; label: string; severity?: Severity }) {
  const color = severityColor(theme, severity);
  return (
    <Text
      numberOfLines={1}
      style={{ flexShrink: 0, ...font(TYPE.badge), color, borderColor: tint(color, 0.5), borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, overflow: "hidden" }}
    >
      {label}
    </Text>
  );
}

export interface ButtonProps {
  theme: PluginTheme;
  label: string;
  onPress: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  /** Pressed state for toggles and segmented controls. */
  active?: boolean;
}

export function Button({ theme, label, onPress, variant = "default", disabled = false, active = false }: ButtonProps) {
  const { colors } = theme;
  const fill = variant === "primary" ? colors.accent : variant === "danger" ? tint(colors.statusDanger, 0.3) : active ? tint(colors.accent, 0.3) : colors.surface2;
  const border = variant === "danger" ? colors.statusDanger : variant === "primary" || active ? colors.accent : colors.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: fill,
        borderColor: border,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: variant === "primary" ? colors.accentForeground : colors.foreground, ...font(TYPE.control), fontWeight: variant === "primary" ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}
