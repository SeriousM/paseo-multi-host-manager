import { useState } from "react";
import { Text, View } from "react-native";
import { font, MONO, TYPE } from "../grid/palette";
import { Button } from "../grid/primitives";
import { addFailureText, addHostView, LABEL_MAX } from "./add-host-rules";
import { Checkbox, Field, Note, SecretField, SectionLabel } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

/**
 * Saves a host on the hub's daemon. Unlike everything else in this plugin it acts at once on Add, not through the
 * staging queue: it only changes the hub's own saved-host list. Link and password are password fields, and their text
 * leaves the dialog only in the `mhm.hosts.add` call.
 */
export function AddHostDialog({ theme, controller, onClose }: DialogProps) {
  const { colors } = theme;
  const [connection, setConnection] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [unencryptedConfirmed, setConfirmed] = useState(false);
  const [hubAskedConfirm, setHubAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const view = addHostView({ connection, label, password, unencryptedConfirmed, hubAskedConfirm });

  const add = async () => {
    setBusy(true);
    setFailure(null);
    const result = await controller.addHost({ connection: connection.trim(), label, password, allowUnencrypted: view.needsConfirm && unencryptedConfirmed });
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
      <SecretField
        theme={theme}
        label="Connection"
        value={connection}
        onChangeText={(text) => {
          setConnection(text);
          setHubAsked(false);
          setFailure(null);
        }}
        placeholder="Pairing link, relay://..., tcp://host:port or host:port"
        invalid={view.severity === "bad"}
      />
      <Note theme={theme} severity={view.severity}>
        {view.note}
      </Note>
      <SectionLabel theme={theme} text="Daemon password (optional)" />
      <SecretField theme={theme} label="Daemon password" value={password} onChangeText={setPassword} placeholder="Only if that host's daemon has one" />
      <Note theme={theme}>A pairing link does not contain the password. Without it the hub cannot sign in to a host whose daemon has one.</Note>
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
          The hub&apos;s daemon stores this connection, with the password inside it, in hosts.json on the hub (Paseo&apos;s own behaviour). This plugin does not keep or log
          either.
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
