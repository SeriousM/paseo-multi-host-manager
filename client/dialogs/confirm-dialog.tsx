import { Text } from "react-native";
import { Button } from "../grid/primitives";
import { itemOnHost } from "../state/staging";
import type { Confirmation } from "../state/types";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

const COPY: Record<Confirmation, { title: string; text: string; action: string }> = {
  trust: { title: "Trust plugin code", text: "Installed plugins run unsandboxed on these hosts.", action: "I trust this code" },
  destructive: { title: "Remove plugins", text: "Removal deletes the plugin's files and settings documents on these hosts.", action: "Remove" },
  lockout: {
    title: "This can cut access",
    text: "These changes switch off the relay or plugins on a host the hub reaches through them. The hub, and this view, may lose the host until it is changed back on the host itself.",
    action: "I understand",
  },
};

/**
 * WP8a stub of the trust, destructive and lockout dialogs (8b owns the final design). Confirming marks the items and
 * continues Apply, which opens the next missing confirmation or sends the batch.
 */
export function ConfirmDialog({ theme, controller, onClose, kind, itemIds }: DialogProps & { kind: Confirmation; itemIds: string[] }) {
  const copy = COPY[kind];
  const items = controller.state.staged.filter((entry) => itemIds.includes(entry.item.id));
  return (
    <DialogFrame
      theme={theme}
      title={copy.title}
      onClose={onClose}
      footer={<Button theme={theme} variant={kind === "trust" ? "primary" : "danger"} label={copy.action} onPress={() => controller.confirm(kind, itemIds)} />}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{copy.text}</Text>
      {items.map(({ item }) => (
        <Text key={item.id} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {controller.state.hosts.find((host) => itemOnHost(item.host, host))?.label ?? item.host}: {item.op}
          {"pluginId" in item && item.pluginId ? ` ${item.pluginId}` : ""}
          {item.op === "setRow" ? ` ${item.rowId} = ${JSON.stringify(item.value)}` : ""}
        </Text>
      ))}
    </DialogFrame>
  );
}
