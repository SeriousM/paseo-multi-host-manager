import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { font, MONO, severityColor, tint, TYPE } from "../grid/palette";
import type { Severity } from "../grid/palette";

/** Tap target with a box and a label; the label may hold any content. */
export function Checkbox({ theme, checked, onChange, disabled = false, children }: { theme: PluginTheme; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; children: ReactNode }) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, opacity: disabled ? 0.45 : 1 }}
    >
      <View style={{ width: 20, height: 20, marginTop: 1, borderRadius: 4, borderWidth: 1, alignItems: "center", justifyContent: "center", borderColor: checked ? colors.accent : colors.border, backgroundColor: checked ? colors.accent : colors.surface2 }}>
        {checked ? <Text style={{ color: colors.accentForeground, fontSize: 12, lineHeight: 14, fontWeight: "700" }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, flexShrink: 1 }}>{children}</View>
    </Pressable>
  );
}

/** Small uppercase heading of a dialog section. */
export function SectionLabel({ theme, text }: { theme: PluginTheme; text: string }) {
  return <Text style={{ color: theme.colors.foregroundMuted, ...font(TYPE.secondary), textTransform: "uppercase", marginTop: 4 }}>{text}</Text>;
}

export function Note({ theme, children, severity = "muted", mono = false }: { theme: PluginTheme; children: ReactNode; severity?: Severity; mono?: boolean }) {
  return <Text style={{ color: severityColor(theme, severity), ...(mono ? { ...MONO, ...font(TYPE.mono) } : font(TYPE.body)) }}>{children}</Text>;
}

/** A host row with a checkbox, its name and a note that says why it is ready or blocked. Blocked rows are disabled. */
export function TargetRow({ theme, label, note, checked, blocked, onToggle }: { theme: PluginTheme; label: string; note: string; checked: boolean; blocked: boolean; onToggle: () => void }) {
  const { colors } = theme;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, backgroundColor: colors.surface1 }}>
      <Checkbox theme={theme} checked={checked} disabled={blocked} onChange={onToggle}>
        <Text style={{ color: colors.foreground, ...font(TYPE.body), fontWeight: "600" }}>{label}</Text>
        <Text style={{ color: blocked ? colors.statusWarning : colors.foregroundMuted, ...font(TYPE.secondary) }}>{note}</Text>
      </Checkbox>
    </View>
  );
}

/** Full-width action of a menu: a label, and below it why it is unavailable or what it does. */
export function MenuButton({ theme, label, note, onPress, disabled = false, danger = false }: { theme: PluginTheme; label: string; note?: string | null; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderColor: danger && !disabled ? colors.statusDanger : colors.border,
        backgroundColor: danger && !disabled ? tint(colors.statusDanger, 0.15) : colors.surface2,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: danger && !disabled ? colors.statusDanger : colors.foreground, ...font(TYPE.body) }}>{label}</Text>
      {note ? <Text style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>{note}</Text> : null}
    </Pressable>
  );
}

export function Field({ theme, value, onChangeText, placeholder, invalid = false }: { theme: PluginTheme; value: string; onChangeText: (text: string) => void; placeholder: string; invalid?: boolean }) {
  const { colors } = theme;
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.foregroundMuted}
      autoCapitalize="none"
      autoCorrect={false}
      style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, backgroundColor: colors.surface2, borderColor: invalid ? colors.statusDanger : colors.border, ...MONO, ...font(TYPE.mono) }}
    />
  );
}

/** A password field for links and daemon passwords: hidden, never autofilled or corrected. */
export function SecretField({ theme, value, onChangeText, placeholder, label, invalid = false }: { theme: PluginTheme; value: string; onChangeText: (text: string) => void; placeholder: string; label: string; invalid?: boolean }) {
  const { colors } = theme;
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.foregroundMuted}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      textContentType="none"
      accessibilityLabel={label}
      style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, backgroundColor: colors.surface2, borderColor: invalid ? colors.statusDanger : colors.border, ...MONO, ...font(TYPE.mono) }}
    />
  );
}
