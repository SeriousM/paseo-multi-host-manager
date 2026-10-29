import { TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { font, MONO, TYPE } from "../grid/palette";
import { Button } from "../grid/primitives";
import { addFailureText, addHostView, LABEL_MAX } from "./add-host-rules";
import { Checkbox, Field, Note, SectionLabel } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

/**
 * Saves a host on the hub's daemon. Unlike everything else in this plugin it acts at once on Add, not through the
 * staging queue: it only changes the hub's own saved-host list. The connection field is a password field, and the
 * text leaves the dialog only in the `mhm.hosts.add` call.
 */
export function AddHostDialog({ theme, controller, onClose }: DialogProps) {
  const { colors } = theme;
  const [connection, setConnection] = useState("");
  const [label, setLabel] = useState("");
  const [unencryptedConfirmed, setConfirmed] = useState(false);
  const [hubAskedConfirm, setHubAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const view = addHostView({ connection, label, unencryptedConfirmed, hubAskedConfirm });

  const add = async () => {
    setBusy(true);
    setFailure(null);
    const result = await controller.addHost({ connection: connection.trim(), label, allowUnencrypted: view.needsConfirm && unencryptedConfirmed });
    setBusy(false);
    if (result === null) return;
    if (typeof result === "string") {
      setFailure(`The hub did not answer: ${result}`);
      return;
    }
    if (result.code === "insecure_link") setHubAsked(true);
    setFailure(addFailureText(result));
  };

  return (
    <DialogFrame
      theme={theme}
      title="Add a host to the hub"
      onClose={onClose}
      closeLabel="Cancel"
      footer={<Button theme={theme} variant="primary" label={busy ? "Adding..." : "Add"} disabled={!view.canAdd || busy} onPress={() => void add()} />}
    >
      <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>
        The grid shows the hosts saved in this hub&apos;s daemon, not the host list of the Paseo app. Paste the host&apos;s pairing link: run{" "}
        <Text style={{ ...MONO, ...font(TYPE.mono) }}>paseo daemon pair --relay</Text> on that host, or use the link you paired the app with.
      </Text>
      <SectionLabel theme={theme} text="Connection" />
      <TextInput
        value={connection}
        onChangeText={(text) => {
          setConnection(text);
          setHubAsked(false);
          setFailure(null);
        }}
        placeholder="Pairing link, relay://..., tcp://host:port or host:port"
        placeholderTextColor={colors.foregroundMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        accessibilityLabel="Connection"
        style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, backgroundColor: colors.surface2, borderColor: view.severity === "bad" ? colors.statusDanger : colors.border, ...MONO, ...font(TYPE.mono) }}
      />
      <Note theme={theme} severity={view.severity}>
        {view.note}
      </Note>
      <SectionLabel theme={theme} text="Label (optional)" />
      <Field theme={theme} value={label} onChangeText={setLabel} placeholder="e.g. laptop" invalid={label.trim().length > LABEL_MAX} />
      {view.needsConfirm ? (
        <Checkbox theme={theme} checked={unencryptedConfirmed} onChange={setConfirmed}>
          <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>I understand this link is not encrypted. Its password and all traffic travel in plain text.</Text>
        </Checkbox>
      ) : null}
      <View style={{ gap: 6, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
        <Note theme={theme}>Add saves the host right away; it is not staged and not part of Apply.</Note>
        <Note theme={theme}>
          The hub&apos;s daemon stores this connection, including any password in it, in hosts.json on the hub (Paseo&apos;s own behaviour). This plugin does not keep or log it.
        </Note>
      </View>
      {failure ? (
        <Note theme={theme} severity="bad">
          {failure}
        </Note>
      ) : null}
    </DialogFrame>
  );
}
