import { Text } from "react-native";
import { findHost, hostSummary } from "../state/grid-model";
import { DialogFrame, Pending } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

/** WP8a stub of the capability dialog (8b): the host's version, link and feature flags from its capability snapshot. */
export function CapabilitiesDialog({ theme, controller, onClose, hostId }: DialogProps & { hostId: string }) {
  const host = findHost(controller.state, hostId);
  if (!host) return null;
  const summary = hostSummary(host);
  const snapshot = host.result.snapshot;
  return (
    <DialogFrame theme={theme} title={`${summary.label} - capabilities`} onClose={onClose}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
        Paseo {summary.version ?? "unknown"} over {summary.link}
      </Text>
      {summary.failure ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{summary.failure.message}</Text> : null}
      <Pending theme={theme} text={snapshot ? `Features: ${snapshot.features.join(", ")}` : "No capability snapshot: the hub did not reach this host."} />
    </DialogFrame>
  );
}
