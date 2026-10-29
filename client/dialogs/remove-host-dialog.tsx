import { useState } from "react";
import { Text, View } from "react-native";
import { font, TYPE } from "../grid/palette";
import { Button } from "../grid/primitives";
import { Checkbox, Note } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";
import { removeFailureText, removeHostView } from "./remove-host-rules";

/**
 * Removes a saved host from the hub. Like Add host it acts at once on Remove, not through Apply, and like every
 * destructive action it needs a ticked confirmation. The host itself is not contacted, so this is also how a host
 * with a wrong password or one that is gone for good leaves the grid.
 */
export function RemoveHostDialog({ theme, controller, onClose, hostId }: DialogProps & { hostId: string }) {
  const { colors } = theme;
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const view = removeHostView(controller.state, hostId);
  if (!view) return null;
  const { label, registrationId, staged, blocked } = view;

  const remove = async () => {
    if (registrationId === null) return;
    setBusy(true);
    setFailure(null);
    const result = await controller.removeHost(hostId, registrationId);
    setBusy(false);
    if (result === null) return;
    setFailure(typeof result === "string" ? `The hub did not answer: ${result}` : removeFailureText(result));
  };

  return (
    <DialogFrame
      theme={theme}
      title={`Remove ${label} from the hub`}
      onClose={onClose}
      closeLabel="Cancel"
      footer={<Button theme={theme} variant="danger" label={busy ? "Removing..." : "Remove"} disabled={!confirmed || blocked !== null || busy} onPress={() => void remove()} />}
    >
      <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>
        Removes {label} from the hosts saved in the hub&apos;s daemon, so this grid no longer shows it. Nothing on {label} changes: its plugins and settings stay as
        they are.
      </Text>
      <View style={{ gap: 6, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
        <Note theme={theme}>Remove acts right away; it is not staged and not part of Apply.</Note>
        {staged > 0 ? (
          <Note theme={theme} severity="warn">
            {staged === 1 ? "1 staged change" : `${staged} staged changes`} for {label} will be dropped from the queue.
          </Note>
        ) : null}
        <Note theme={theme}>To add it again later you need its pairing link.</Note>
      </View>
      {blocked ? (
        <Note theme={theme} severity="warn">
          {blocked}
        </Note>
      ) : (
        <Checkbox theme={theme} checked={confirmed} onChange={setConfirmed}>
          <Text style={{ color: colors.foreground, ...font(TYPE.body) }}>I want to remove the hub&apos;s saved connection to {label}.</Text>
        </Checkbox>
      )}
      {failure ? (
        <Note theme={theme} severity="bad">
          {failure}
        </Note>
      ) : null}
    </DialogFrame>
  );
}
