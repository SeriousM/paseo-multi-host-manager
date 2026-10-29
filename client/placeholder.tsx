import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";

export function PlaceholderScreen({ theme }: PluginScreenProps) {
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground }}>Multi-host manager: coming soon.</Text>
    </View>
  );
}
