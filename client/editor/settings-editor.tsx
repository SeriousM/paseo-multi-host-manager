import { DialogFrame, Pending } from "../dialogs/dialog-frame";
import type { DialogProps } from "../dialogs/dialog-frame";

/**
 * WP8a stub of the settings-document editor (8c). The editor reads the document with `mhm.doc.read` (masked), lets the
 * user edit it, and stages a `writeSettingsDoc` item (`expectedRevision` = the revision it read; masked placeholders
 * keep the stored value) plus, as the follow-up the outcome's `reloadSuggested` asks for, a `reloadPlugin` item.
 */
export interface SettingsEditorProps extends DialogProps {
  hostId: string;
  pluginId: string;
  settingsId: string;
}

export function SettingsEditor({ theme, onClose, hostId, pluginId, settingsId }: SettingsEditorProps) {
  return (
    <DialogFrame theme={theme} title={`Edit ${pluginId}/${settingsId}`} onClose={onClose}>
      <Pending theme={theme} text={`Settings editor for ${hostId}: coming with WP8c.`} />
    </DialogFrame>
  );
}
