import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "../grid/primitives";
import type { Confirmation, GridHost } from "../state/types";
import { Checkbox, Note } from "./controls";
import { lockoutLines, removalLines, trustLines } from "./confirm-text";
import type { ConfirmLine } from "./confirm-text";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

const TITLE: Record<Confirmation, string> = { trust: "Trust plugin code", destructive: "Remove plugins", lockout: "This can cut access" };
const INTRO: Record<Confirmation, string> = {
  trust: "These plugins are installed from the sources below. Installed plugins run unsandboxed on the host.",
  destructive: "Removal stops the plugin and deletes its files and its settings documents on the host.",
  lockout: "Applying these changes can cut the hub off a host, or this view off the hub.",
};
const ACTION: Record<Confirmation, string> = { trust: "Install", destructive: "Remove", lockout: "Apply anyway" };

function hostList(lines: readonly ConfirmLine[]): string {
  return [...new Set(lines.map((line) => line.host))].join(", ");
}

/**
 * Trust (install), destructive (remove) and lockout dialogs. The confirmation is a checkbox, never a single tap:
 * `controller.confirm` marks the items, closes the dialog and continues Apply.
 */
export function ConfirmDialog({ theme, controller, onClose, kind, itemIds }: DialogProps & { kind: Confirmation; itemIds: string[] }) {
  const { colors } = theme;
  const hosts: GridHost[] = controller.state.hosts;
  const entries = controller.state.staged.filter((entry) => itemIds.includes(entry.item.id) && entry.status !== "ok");
  const lines = kind === "trust" ? trustLines(entries, hosts) : kind === "destructive" ? removalLines(entries, hosts) : lockoutLines(entries, hosts);
  const latest = kind === "trust" && lines.some((line) => line.pin === "latest");
  const [main, setMain] = useState(false);
  const [versions, setVersions] = useState(false);
  const ready = lines.length > 0 && main && (!latest || versions);
  const affected = hostList(lines);

  return (
    <DialogFrame
      theme={theme}
      title={TITLE[kind]}
      onClose={onClose}
      closeLabel="Cancel"
      footer={
        <Button
          theme={theme}
          variant={kind === "trust" ? "primary" : "danger"}
          label={ACTION[kind]}
          disabled={!ready}
          onPress={() => controller.confirm(kind, lines.map((line) => line.itemId))}
        />
      }
    >
      <Text style={{ color: colors.foreground, fontSize: 13 }}>{INTRO[kind]}</Text>
      <View style={{ gap: 6 }}>
        {lines.map((line) => (
          <View key={line.itemId} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 8, backgroundColor: colors.surface1, gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {line.host}: {line.title}
            </Text>
            <Note theme={theme} severity={line.pin === "latest" ? "warn" : "muted"} mono={kind === "trust"}>
              {line.detail}
            </Note>
          </View>
        ))}
        {lines.length === 0 ? <Note theme={theme}>Nothing in the queue needs this confirmation any more.</Note> : null}
      </View>
      {kind === "trust" ? (
        <>
          <Checkbox theme={theme} checked={main} onChange={setMain}>
            <Text style={{ color: colors.foreground, fontSize: 12 }}>I trust the plugin code to be installed. It runs unsandboxed on: {affected}.</Text>
          </Checkbox>
          {latest ? (
            <Checkbox theme={theme} checked={versions} onChange={setVersions}>
              <Text style={{ color: colors.foreground, fontSize: 12 }}>I know sources marked "installs the latest release" can install a different version than the one on the other hosts.</Text>
            </Checkbox>
          ) : null}
        </>
      ) : null}
      {kind === "destructive" ? (
        <Checkbox theme={theme} checked={main} onChange={setMain}>
          <Text style={{ color: colors.foreground, fontSize: 12 }}>I understand removal deletes plugin files and settings on: {affected}.</Text>
        </Checkbox>
      ) : null}
      {kind === "lockout" ? (
        <Checkbox theme={theme} checked={main} onChange={setMain}>
          <Text style={{ color: colors.foreground, fontSize: 12 }}>I understand the hub can lose access to: {affected}. It may only be reversible on the host itself.</Text>
        </Checkbox>
      ) : null}
    </DialogFrame>
  );
}
