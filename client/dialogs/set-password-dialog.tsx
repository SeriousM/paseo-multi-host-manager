import { useState } from "react";
import { Text, View } from "react-native";
import { font, MONO, TYPE } from "../grid/palette";
import { Button } from "../grid/primitives";
import { addFailureText, reachText, setPasswordView } from "./add-host-rules";
import { Checkbox, Note, SecretField, SectionLabel } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

/**
 * Sets the daemon password of a saved host. Paseo keeps the password inside the saved connection and never hands that
 * connection back, so the dialog asks for the host's link again and saves link plus password in its place
 * (`mhm.hosts.password`). Direct, not staged; it stays open to say whether the hub reaches the host now.
 */
export function SetPasswordDialog({ theme, controller, onClose, hostId }: DialogProps & { hostId: string }) {
  const { colors } = theme;
  const [connection, setConnection] = useState("");
  const [password, setPassword] = useState("");
  const [unencryptedConfirmed, setConfirmed] = useState(false);
  const [hubAskedConfirm, setHubAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const view = setPasswordView(controller.state, hostId, { connection, password, unencryptedConfirmed, hubAskedConfirm });
  if (!view) return null;
  const { label, registrationId } = view;

  const save = async () => {
    if (registrationId === null) return;
    setBusy(true);
    setOutcome(null);
    const result = await controller.setPassword(registrationId, { connection: connection.trim(), password, allowUnencrypted: view.needsConfirm && unencryptedConfirmed });
    setBusy(false);
    if (typeof result === "string") {
      setOutcome({ ok: false, text: `The hub did not answer: ${result}` });
    } else if ("code" in result) {
      if (result.code === "insecure_link") setHubAsked(true);
      setOutcome({ ok: false, text: addFailureText(result) });
    } else {
      setOutcome(reachText(result));
    }
  };

  return (
    <DialogFrame
      theme={theme}
      title={`Daemon password for ${label}`}
      onClose={onClose}
      closeLabel={outcome?.ok ? "Done" : "Cancel"}
      footer={<Button theme={theme} variant="primary" label={busy ? "Saving..." : "Save"} disabled={!view.canAdd || busy} onPress={() => void save()} />}
    >
      <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>
        Paseo keeps a saved host&apos;s password inside its connection and does not hand that connection back, so the password cannot be added on its own. Paste
        {" "}{label}&apos;s link again (run <Text style={{ ...MONO, ...font(TYPE.mono) }}>paseo daemon pair --relay</Text> there, or use the link you paired the app with) and
        its daemon password; both replace the saved connection. The label stays, and the hub refuses a link that reaches a different daemon.
      </Text>
      <SectionLabel theme={theme} text="Connection" />
      <SecretField
        theme={theme}
        label="Connection"
        value={connection}
        onChangeText={(text) => {
          setConnection(text);
          setHubAsked(false);
          setOutcome(null);
        }}
        placeholder="Pairing link, relay://..., tcp://host:port or host:port"
        invalid={view.severity === "bad"}
      />
      <Note theme={theme} severity={view.severity}>
        {view.note}
      </Note>
      <SectionLabel theme={theme} text="Daemon password" />
      <SecretField theme={theme} label="Daemon password" value={password} onChangeText={setPassword} placeholder="The password of that host's daemon" />
      {view.needsConfirm ? (
        <Checkbox theme={theme} checked={unencryptedConfirmed} onChange={setConfirmed}>
          <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>I understand this link is not encrypted. Its password and all traffic travel in plain text.</Text>
        </Checkbox>
      ) : null}
      <View style={{ gap: 6, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
        <Note theme={theme}>Save acts right away; it is not staged and not part of Apply.</Note>
        <Note theme={theme}>
          The hub&apos;s daemon stores the connection, with the password inside it, in hosts.json on the hub (Paseo&apos;s own behaviour). This plugin does not keep or log
          either.
        </Note>
      </View>
      {view.blocked ? (
        <Note theme={theme} severity="warn">
          {view.blocked}
        </Note>
      ) : null}
      {outcome ? (
        <Note theme={theme} severity={outcome.ok ? "ok" : "bad"}>
          {outcome.text}
        </Note>
      ) : null}
    </DialogFrame>
  );
}
