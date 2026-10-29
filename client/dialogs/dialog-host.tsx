import { SettingsEditor } from "../editor/settings-editor";
import type { MhmSurfaceProps } from "../surface";
import { CapabilitiesDialog } from "./capabilities-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { InstallDialog, PluginMenuDialog, RemoveDialog } from "./plugin-dialogs";

/** Renders the dialog `state.dialog` names. Open one with `dispatch({ type: "openDialog", dialog })`. */
export function DialogHost(props: MhmSurfaceProps) {
  const { state, dispatch } = props.controller;
  const dialog = state.dialog;
  if (!dialog) return null;
  const common = { ...props, onClose: () => dispatch({ type: "closeDialog" }) };
  switch (dialog.kind) {
    case "trust":
    case "destructive":
    case "lockout":
      return <ConfirmDialog {...common} kind={dialog.kind} itemIds={dialog.itemIds} />;
    case "capabilities":
      return <CapabilitiesDialog {...common} hostId={dialog.hostId} />;
    case "pluginMenu":
      return <PluginMenuDialog {...common} pluginId={dialog.pluginId} hostId={dialog.hostId} />;
    case "install":
      return <InstallDialog {...common} pluginId={dialog.pluginId} hostId={dialog.hostId} />;
    case "remove":
      return <RemoveDialog {...common} pluginId={dialog.pluginId} hostId={dialog.hostId} />;
    case "editor":
      return <SettingsEditor {...common} hostId={dialog.hostId} pluginId={dialog.pluginId} settingsId={dialog.settingsId} />;
  }
}
