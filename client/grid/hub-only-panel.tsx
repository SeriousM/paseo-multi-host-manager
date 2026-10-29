import { Text, View } from "react-native";
import type { MhmSurfaceProps } from "../surface";
import { font, MONO, TYPE } from "./palette";
import { Button } from "./primitives";

/** Why only the hub shows, the two host lists, and the way to add a host (dialog or CLI). */
export function HubOnlyPanel({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { colors } = theme;
  const body = { color: colors.foreground, ...font(TYPE.body) };
  const muted = { color: colors.foregroundMuted, ...font(TYPE.secondary) };
  return (
    <View style={{ maxWidth: 620, gap: 12, padding: 18, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foreground, ...font(TYPE.title), fontWeight: "600" }}>Only the hub so far</Text>
      <Text style={body}>
        This grid shows the hosts saved in this hub&apos;s daemon. The hosts in the Paseo app&apos;s own host list are a separate list, kept by the app, and a plugin cannot
        use it.
      </Text>
      <Text style={body}>
        Add each host here once with its pairing link: run <Text style={{ ...MONO, ...font(TYPE.mono) }}>paseo daemon pair --relay</Text> on that host, or use the link you
        paired the app with.
      </Text>
      <View style={{ flexDirection: "row" }}>
        <Button theme={theme} variant="primary" label="Add host..." onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "addHost" } })} />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={muted}>Or in a terminal on the hub (keep the quotes, the link contains &amp;):</Text>
        <Text style={{ ...muted, ...MONO }}>paseo host add &apos;&lt;link&gt;&apos; --label laptop</Text>
      </View>
    </View>
  );
}
