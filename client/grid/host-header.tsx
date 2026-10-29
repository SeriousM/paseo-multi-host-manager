import { Pressable, Text, View } from "react-native";
import type { LinkKind } from "../../shared/contracts";
import { hostSummary } from "../state/grid-model";
import type { GridHost } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { SIZES, severityColor } from "./palette";
import type { Severity } from "./palette";
import { Badge } from "./primitives";

const LINK_BADGE: Record<LinkKind, [Severity, string]> = {
  relay: ["ok", "relay E2EE"],
  ssh: ["ok", "SSH tunnel"],
  loopback: ["ok", "loopback"],
  tls: ["ok", "TLS"],
  "tcp-plain": ["warn", "tcp unencrypted"],
  unknown: ["warn", "unknown link"],
};

const COMPANION_BADGE: Record<string, [Severity, string]> = {
  ok: ["ok", "companion"],
  missing: ["bad", "companion missing"],
  disabled: ["warn", "companion off"],
  failed: ["bad", "companion failed"],
};

const PLATFORM: Record<string, string> = { win32: "WIN", linux: "LNX", darwin: "MAC" };

export function HostHeader({ theme, controller, host, width }: Pick<MhmSurfaceProps, "theme" | "controller"> & { host: GridHost; width: number }) {
  const summary = hostSummary(host);
  const { colors } = theme;
  const [linkSeverity, linkLabel] = LINK_BADGE[summary.link];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${summary.label} capabilities`}
      onPress={() => controller.dispatch({ type: "openDialog", dialog: { kind: "capabilities", hostId: host.id } })}
      style={{ width, height: SIZES.headerHeight, overflow: "hidden", padding: 9, gap: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: summary.reachable ? colors.statusSuccess : colors.statusDanger }} />
        <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600", fontSize: 14, maxWidth: width - 90 }}>
          {summary.label}
        </Text>
        {summary.platform ? <Badge theme={theme} label={PLATFORM[summary.platform] ?? summary.platform} severity="accent" /> : null}
        {summary.isHub ? <Badge theme={theme} label="hub" severity="accent" /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Paseo {summary.version ?? "?"}</Text>
        {summary.versionTag ? <Badge theme={theme} label={summary.versionTag === "prerelease" ? "pre-release" : "untested"} severity={summary.versionTag === "prerelease" ? "bad" : "warn"} /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Badge theme={theme} label={linkLabel} severity={linkSeverity} />
        {summary.companion ? <Badge theme={theme} label={COMPANION_BADGE[summary.companion][1]} severity={COMPANION_BADGE[summary.companion][0]} /> : null}
      </View>
      {summary.failure ? (
        <Text numberOfLines={2} style={{ color: severityColor(theme, "bad"), fontSize: 11 }}>
          {summary.failure.message}
        </Text>
      ) : null}
    </Pressable>
  );
}
