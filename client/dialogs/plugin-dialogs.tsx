import { DialogFrame, Pending } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";

/**
 * WP8a stubs; 8b replaces the bodies. Rules the final dialogs must keep:
 * - Stage through `controller.dispatch({ type: "stage", inputs })`; never call `mhm.apply` directly.
 * - Do not offer disabling or removing multi-host-manager on the hub (`stageRefusal` drops such items).
 * - "Edit settings" opens `{ kind: "editor", ... }` (8c); copying a document uses `controller.copyDoc`.
 */
export interface PluginDialogProps extends DialogProps {
  pluginId: string;
  /** The host the dialog was opened from; null when opened from the row label ("Install on...", "Remove from..."). */
  hostId: string | null;
}

export function PluginMenuDialog({ theme, onClose, pluginId, hostId }: PluginDialogProps) {
  return (
    <DialogFrame theme={theme} title={`${pluginId} on ${hostId ?? "?"}`} onClose={onClose}>
      <Pending theme={theme} text="Enable or disable, update, remove, edit settings: coming with WP8b." />
    </DialogFrame>
  );
}

export function InstallDialog({ theme, onClose, pluginId }: PluginDialogProps) {
  return (
    <DialogFrame theme={theme} title={`Install ${pluginId}`} onClose={onClose}>
      <Pending theme={theme} text="Pick target hosts and stage the install: coming with WP8b. Until then copy the plugin cell and paste it." />
    </DialogFrame>
  );
}

export function RemoveDialog({ theme, onClose, pluginId }: PluginDialogProps) {
  return (
    <DialogFrame theme={theme} title={`Remove ${pluginId}`} onClose={onClose}>
      <Pending theme={theme} text="Pick hosts and stage the removal: coming with WP8b." />
    </DialogFrame>
  );
}
