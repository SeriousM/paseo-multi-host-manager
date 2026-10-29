import { Text, View } from "react-native";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { Badge, Button } from "../grid/primitives";
import { findHost, hostSummary } from "../state/grid-model";
import { withInsecureLink } from "../state/policy";
import { itemOnHost } from "../state/staging";
import { capabilityReport, LINK_INFO } from "./capability-report";
import { Checkbox, Note, SectionLabel } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";
import { companionInstall, installBlocker } from "./plugin-rules";

const COMPANION_TEXT: Record<string, string> = {
  ok: "multi-host-manager is running on this host.",
  missing: "multi-host-manager is not installed on this host. Without it the hub cannot read or write the rows and settings documents that need it.",
  disabled: "multi-host-manager is installed but off (the plugin is disabled, or plugins are switched off on the host).",
  failed: "multi-host-manager is installed but failed to start. See the plugin's log on that host.",
};

/** Host version and tier, missing features and what they block, link kind with the opt-in for unencrypted links, companion state. */
export function CapabilitiesDialog({ theme, controller, onClose, hostId }: DialogProps & { hostId: string }) {
  const { colors } = theme;
  const { state, dispatch, policy } = controller;
  const host = findHost(state, hostId);
  if (!host) return null;
  const summary = hostSummary(host);
  const report = capabilityReport(host);
  const link = LINK_INFO[host.link];
  const blockedLink = host.link === "tcp-plain" || host.link === "unknown";
  const registrationId = host.registrationId;
  const allowed = registrationId !== null && policy.insecureLinkRegistrationIds.includes(registrationId);
  const companion = summary.companion;
  const installStaged = state.staged.some(({ item }) => item.op === "installPlugin" && item.pluginId === OWN_PLUGIN_ID && itemOnHost(item.host, host));
  const installBlock = companion === "missing" ? installBlocker(state, host, OWN_PLUGIN_ID) : null;
  const install = companionInstall(state, host);

  return (
    <DialogFrame theme={theme} title={`${summary.label} - capabilities`} onClose={onClose}>
      {summary.failure ? <Note theme={theme} severity="bad">{summary.failure.message}</Note> : null}

      <SectionLabel theme={theme} text="Paseo version" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{report.version ?? "unknown"}</Text>
        <Badge theme={theme} label={report.tier === "below_minimum" ? "below minimum" : report.tier} severity={report.tierSeverity} />
      </View>
      <Note theme={theme}>{report.tierText}</Note>
      {report.tier === "prerelease" ? (
        <Button
          theme={theme}
          label={policy.allowPrerelease ? "Pre-release hosts: allowed (tap to block)" : "Allow pre-release hosts"}
          active={policy.allowPrerelease}
          onPress={() => void controller.savePolicy({ ...policy, allowPrerelease: !policy.allowPrerelease })}
        />
      ) : null}

      <SectionLabel theme={theme} text="Features" />
      {report.hasSnapshot ? (
        <View style={{ gap: 4 }}>
          {report.missing > 0 ? <Note theme={theme} severity="warn">{report.missing} missing. Actions that need them are blocked on this host.</Note> : <Note theme={theme}>All features this plugin uses are present.</Note>}
          {report.features.map((feature) => (
            <View key={feature.flag} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Text style={{ width: 56, fontSize: 12, color: feature.present ? colors.statusSuccess : colors.statusWarning }}>{feature.present ? "present" : "missing"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{feature.flag}</Text>
                <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                  {feature.present ? feature.allows : `Blocks: ${feature.allows}. Needs Paseo ${feature.since} or newer.`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Note theme={theme}>No capability snapshot: the hub did not reach this host.</Note>
      )}

      <SectionLabel theme={theme} text="Connection" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge theme={theme} label={link.label} severity={link.severity} />
      </View>
      <Note theme={theme}>{link.text}</Note>
      {blockedLink ? (
        registrationId !== null ? (
          <Checkbox theme={theme} checked={allowed} onChange={(next) => void controller.savePolicy(withInsecureLink(policy, registrationId, next))}>
            <Text style={{ color: colors.foreground, fontSize: 12 }}>Allow unencrypted link to this host</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Anything sent over it, including settings, can be read on the network. Use only over a VPN or a trusted LAN.</Text>
          </Checkbox>
        ) : (
          <Note theme={theme} severity="warn">This host is not a saved host of the hub, so it cannot be allowed.</Note>
        )
      ) : null}

      {companion ? (
        <>
          <SectionLabel theme={theme} text="multi-host-manager on this host" />
          <Note theme={theme} severity={companion === "ok" ? "ok" : companion === "disabled" ? "warn" : "bad"}>{COMPANION_TEXT[companion]}</Note>
          {companion === "missing" ? (
            <>
              <Button
                theme={theme}
                variant="primary"
                label={installStaged ? "Install staged" : "Install companion"}
                disabled={installBlock !== null || !install.ok || installStaged}
                onPress={() => {
                  if (!install.ok) return;
                  dispatch({ type: "stage", inputs: [install.input] });
                  onClose();
                }}
              />
              <Note theme={theme}>
                {installBlock ?? (install.ok ? `Stages an install that ${install.note}. Nothing happens until you press Apply.` : install.reason)}
              </Note>
            </>
          ) : null}
        </>
      ) : null}
    </DialogFrame>
  );
}
