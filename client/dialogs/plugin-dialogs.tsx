import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { PIN_TEXT, installPin } from "../drawer/staging-view";
import { Button } from "../grid/primitives";
import { findHost, formatPlugin, hostData, pluginRows } from "../state/grid-model";
import { hostRef } from "../state/staging";
import type { StageInput } from "../state/types";
import { Field, MenuButton, Note, SectionLabel, TargetRow } from "./controls";
import { DialogFrame } from "./dialog-frame";
import type { DialogProps } from "./dialog-frame";
import { installBlocker, parseInstallSource, pluginMenuRules, removeBlocker } from "./plugin-rules";

/**
 * Rules the dialogs keep:
 * - They stage through `dispatch({ type: "stage", inputs })`; they never call `mhm.apply` themselves.
 * - They never offer disabling or removing multi-host-manager on the hub (`stageRefusal` would drop it anyway).
 * - "Edit settings" opens the 8c editor; "Copy to hosts" puts the plugin on the clipboard.
 */
export interface PluginDialogProps extends DialogProps {
  /** Empty when a new plugin is installed from a typed source. */
  pluginId: string;
  /** The host the dialog was opened from; null when opened from the row label ("Install on...", "Remove from..."). */
  hostId: string | null;
}

export function PluginMenuDialog({ theme, controller, onClose, pluginId, hostId }: PluginDialogProps) {
  const { state, dispatch } = controller;
  const host = hostId === null ? undefined : findHost(state, hostId);
  const plugin = host ? hostData(host)?.plugins.find((candidate) => candidate.id === pluginId) : undefined;
  if (!host || !plugin) return null;
  const rules = pluginMenuRules(host, pluginId);
  const stage = (input: StageInput) => {
    dispatch({ type: "stage", inputs: [input] });
    onClose();
  };
  const base = { host: hostRef(host), pluginId };

  return (
    <DialogFrame theme={theme} title={`${plugin.name ?? pluginId} on ${host.label}`} onClose={onClose}>
      <Note theme={theme}>
        {pluginId} {formatPlugin(plugin)}, {plugin.enabled ? plugin.status : "disabled"}. Source: {plugin.source.kind}
        {plugin.source.installSource ? ` (${plugin.source.installSource})` : ""}.
      </Note>
      <View style={{ gap: 6 }}>
        <MenuButton
          theme={theme}
          label="Copy to hosts"
          note="Puts the plugin on the clipboard; pick hosts in the clipboard bar."
          onPress={() => {
            dispatch({ type: "copy", ref: { kind: "plugin", pluginId, hostId: host.id } });
            onClose();
          }}
        />
        {rules.documents.length > 0 ? (
          rules.documents.map((settingsId) => (
            <MenuButton
              key={settingsId}
              theme={theme}
              label={rules.documents.length > 1 ? `Edit settings: ${settingsId}` : "Edit settings"}
              note={`Document ${settingsId} on ${host.label}`}
              onPress={() => dispatch({ type: "openDialog", dialog: { kind: "editor", pluginId, settingsId, hostId: host.id } })}
            />
          ))
        ) : (
          <MenuButton theme={theme} label="Edit settings" note={rules.editor} disabled onPress={onClose} />
        )}
        {rules.selfOnHub ? null : (
          <MenuButton
            theme={theme}
            label={plugin.enabled ? "Disable plugin" : "Enable plugin"}
            note={rules.manage}
            disabled={rules.manage !== null}
            onPress={() => stage({ op: "setPluginEnabled", ...base, enabled: !plugin.enabled })}
          />
        )}
        <MenuButton theme={theme} label="Check for update" note={rules.update ?? "Applies as a check only; the result shows in the staged list."} disabled={rules.update !== null} onPress={() => stage({ op: "updatePlugin", ...base, checkOnly: true })} />
        <MenuButton theme={theme} label="Update to the newest release" note={rules.update} disabled={rules.update !== null} onPress={() => stage({ op: "updatePlugin", ...base })} />
        <MenuButton theme={theme} label="Reload plugin" note={rules.manage} disabled={rules.manage !== null} onPress={() => stage({ op: "reloadPlugin", ...base })} />
        {rules.selfOnHub ? (
          <Note theme={theme}>multi-host-manager runs this view on the hub. It cannot be disabled or removed from here.</Note>
        ) : (
          <MenuButton
            theme={theme}
            danger
            label={`Remove from ${host.label}...`}
            note={rules.manage}
            disabled={rules.manage !== null}
            onPress={() => dispatch({ type: "openDialog", dialog: { kind: "remove", pluginId, hostId: host.id } })}
          />
        )}
      </View>
    </DialogFrame>
  );
}

/** Picked host ids. Callers only use the ones that are still unblocked, so a host that turns blocked after a reload drops out. */
function usePicks(initial: string | null) {
  const [picked, setPicked] = useState<string[]>(initial === null ? [] : [initial]);
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  return { picked, toggle };
}

export function InstallDialog({ theme, controller, onClose, pluginId, hostId }: PluginDialogProps) {
  const { state, dispatch } = controller;
  const known = useMemo(() => pluginRows(state.hosts).find((row) => row.id === pluginId), [state.hosts, pluginId]);
  const knownSource = known?.source?.installSource ?? null;
  const [text, setText] = useState(knownSource ?? "");
  const { picked, toggle } = usePicks(hostId);
  const parsed = parseInstallSource(text);
  // The commit that pins a known git source only belongs to that exact source text.
  const ref = knownSource !== null && text.trim() === knownSource ? (known?.source?.ref ?? undefined) : undefined;
  const targets = state.hosts.map((host) => ({ host, blocked: installBlocker(state, host, pluginId) }));
  const chosen = targets.filter(({ host, blocked }) => blocked === null && picked.includes(host.id));
  const pin = parsed.ok ? installPin(parsed.source, ref) : null;

  return (
    <DialogFrame
      theme={theme}
      title={pluginId === "" ? "Install a plugin" : `Install ${known?.name ?? pluginId}`}
      onClose={onClose}
      closeLabel="Cancel"
      footer={
        <Button
          theme={theme}
          variant="primary"
          label={`Stage install on ${chosen.length} host(s)`}
          disabled={!parsed.ok || chosen.length === 0}
          onPress={() => {
            if (!parsed.ok) return;
            const inputs: StageInput[] = chosen.map(({ host }) => ({
              op: "installPlugin",
              host: hostRef(host),
              source: parsed.source,
              ...(ref === undefined ? null : { ref }),
              ...(pluginId === "" ? null : { pluginId }),
            }));
            dispatch({ type: "stage", inputs });
            onClose();
          }}
        />
      }
    >
      <SectionLabel theme={theme} text="Source" />
      <Field theme={theme} value={text} onChangeText={setText} placeholder="owner/name, npm:package@1.2.3 or git:https://host/owner/repo" invalid={!parsed.ok && !parsed.empty} />
      {parsed.ok ? (
        <Note theme={theme} severity={pin === "latest" ? "warn" : "muted"}>
          {parsed.kind === "registry" ? "Registry. " : parsed.kind === "npm" ? "npm package. " : "Git repository. "}
          {pin === "pinned" ? `Pinned: ${PIN_TEXT.pinned}.` : `This ${PIN_TEXT.latest}; ${parsed.kind === "registry" ? "a registry install cannot pin a version" : "add @<version> (npm) to pin one"}.`}
        </Note>
      ) : (
        <Note theme={theme} severity={parsed.empty ? "muted" : "bad"}>
          {parsed.reason}
          {pluginId !== "" && knownSource === null && parsed.empty ? " This plugin is a local directory on its own host and cannot be copied; install it from a registry, npm or git source." : ""}
        </Note>
      )}
      <SectionLabel theme={theme} text="Target hosts" />
      <View style={{ gap: 6 }}>
        {targets.map(({ host, blocked }) => (
          <TargetRow
            key={host.id}
            theme={theme}
            label={host.label}
            note={blocked ?? "ready"}
            checked={blocked === null && picked.includes(host.id)}
            blocked={blocked !== null}
            onToggle={() => toggle(host.id)}
          />
        ))}
      </View>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Nothing is installed until you press Apply and confirm trust.</Text>
    </DialogFrame>
  );
}

export function RemoveDialog({ theme, controller, onClose, pluginId, hostId }: PluginDialogProps) {
  const { state, dispatch } = controller;
  const { picked, toggle } = usePicks(hostId);
  const targets = state.hosts.map((host) => ({ host, blocked: removeBlocker(host, pluginId) }));
  const chosen = targets.filter(({ host, blocked }) => blocked === null && picked.includes(host.id));

  return (
    <DialogFrame
      theme={theme}
      title={`Remove ${pluginId}`}
      onClose={onClose}
      closeLabel="Cancel"
      footer={
        <Button
          theme={theme}
          variant="danger"
          label={`Stage removal on ${chosen.length} host(s)`}
          disabled={chosen.length === 0}
          onPress={() => {
            dispatch({ type: "stage", inputs: chosen.map(({ host }): StageInput => ({ op: "removePlugin", host: hostRef(host), pluginId })) });
            onClose();
          }}
        />
      }
    >
      <Note theme={theme}>Stops the plugin and deletes its files and its settings documents on the selected hosts. A local source directory is kept.</Note>
      {pluginId === OWN_PLUGIN_ID ? <Note theme={theme} severity="warn">Removing multi-host-manager from a host ends the settings documents and companion rows there.</Note> : null}
      <View style={{ gap: 6 }}>
        {targets.map(({ host, blocked }) => {
          const installed = hostData(host)?.plugins.find((plugin) => plugin.id === pluginId);
          return (
            <TargetRow
              key={host.id}
              theme={theme}
              label={host.label}
              note={blocked ?? (installed ? `${formatPlugin(installed)}, ${installed.status}` : "")}
              checked={blocked === null && picked.includes(host.id)}
              blocked={blocked !== null}
              onToggle={() => toggle(host.id)}
            />
          );
        })}
      </View>
    </DialogFrame>
  );
}
