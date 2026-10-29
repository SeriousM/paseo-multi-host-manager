import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ROW_BY_ID } from "../../shared/rows";
import { planPaste } from "../state/clipboard";
import { baselineHost, compareRowCell, comparePluginCell, copyFromBaseline, differenceCount, planBaselineSync } from "../state/compare";
import { findHost, hostData, pluginRows } from "../state/grid-model";
import type { CellRef, GridHost } from "../state/types";
import type { MhmSurfaceProps } from "../surface";
import { Button } from "./primitives";
import { font, TYPE } from "./palette";

type BarProps = Pick<MhmSurfaceProps, "theme" | "controller">;

function Bar({ theme, title, subtitle, children }: Pick<MhmSurfaceProps, "theme"> & { title: string; subtitle: string; children: ReactNode }) {
  const { colors } = theme;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <View style={{ flexShrink: 1, minWidth: 160 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600", ...font(TYPE.body) }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, ...font(TYPE.secondary) }}>
          {subtitle}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}

function Reason({ theme, text }: Pick<MhmSurfaceProps, "theme"> & { text: string }) {
  return (
    <Text numberOfLines={2} style={{ color: theme.colors.statusWarning, ...font(TYPE.secondary), maxWidth: 260 }}>
      {text}
    </Text>
  );
}

/** A tapped host header: baseline choice, staging every difference from the baseline, capabilities. */
function HostActions({ theme, controller, host }: BarProps & { host: GridHost }) {
  const { state, dispatch } = controller;
  const baseline = baselineHost(state);
  const isBaseline = baseline?.id === host.id;
  const sync = baseline && !isBaseline && host.result.ok ? planBaselineSync(state, host.id) : null;
  const refused = sync?.refusals ?? [];
  const subtitle = !baseline ? "No baseline: pick one to see how the other hosts differ." : isBaseline ? "This host is the baseline." : `${differenceCount(state, host.id)} differ from ${baseline.label}.`;
  return (
    <Bar theme={theme} title={host.label} subtitle={subtitle}>
      {host.result.ok && !isBaseline ? <Button theme={theme} label="Use as baseline" onPress={() => dispatch({ type: "setBaseline", hostId: host.id })} /> : null}
      {isBaseline ? <Button theme={theme} label="Clear baseline" onPress={() => dispatch({ type: "setBaseline", hostId: null })} /> : null}
      {sync ? (
        <Button
          theme={theme}
          variant="primary"
          label={`Stage ${sync.inputs.length} from baseline`}
          disabled={sync.inputs.length === 0 || state.applying}
          onPress={() => dispatch({ type: "stage", inputs: sync.inputs })}
        />
      ) : null}
      {refused.length > 0 ? (
        <Reason
          theme={theme}
          text={`Not stageable: ${refused
            .slice(0, 3)
            .map((refusal) => `${refusal.label} (${refusal.reason})`)
            .join(", ")}${refused.length > 3 ? ` and ${refused.length - 3} more` : ""}`}
        />
      ) : null}
      <Button theme={theme} label="Capabilities..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "capabilities", hostId: host.id } })} />
      {/* Also for hosts the hub cannot reach (wrong password, gone): removal only touches the hub's saved list. */}
      {host.isHub ? null : (
        <Button theme={theme} variant="danger" label="Remove saved host..." disabled={state.applying} onPress={() => dispatch({ type: "openDialog", dialog: { kind: "removeHost", hostId: host.id } })} />
      )}
      <Button theme={theme} label="Close" onPress={() => dispatch({ type: "select", ref: null })} />
    </Bar>
  );
}

/**
 * Replaces the mockup's hover buttons: what can be done with the selected cell. Copy, Paste (or Install here), Copy
 * from baseline, and for plugins the per-plugin menu or the install dialog. Hidden while nothing is selected.
 */
export function ActionBar({ theme, controller }: BarProps) {
  const { state, dispatch } = controller;
  const ref = state.selection;
  if (!ref || ref.kind === "doc") return null;
  const host = findHost(state, ref.hostId);
  if (!host) return null;
  if (ref.kind === "host") return <HostActions theme={theme} controller={controller} host={host} />;
  const cellRef: CellRef = ref;
  const row = ref.kind === "plugin" ? pluginRows(state.hosts).find((candidate) => candidate.id === ref.pluginId) : undefined;
  const view = ref.kind === "row" ? compareRowCell(state, ref.rowId, ref.hostId) : row ? comparePluginCell(state, row, ref.hostId) : null;
  if (!view) return null;
  const title = `${ref.kind === "row" ? (ROW_BY_ID[ref.rowId]?.label ?? ref.rowId) : ref.pluginId} on ${host.label}`;
  const clip = state.clipboard;
  // Paste goes to the clipboard's own row or plugin only; a settings document belongs to its plugin's cell.
  const sameCell = clip !== null && (clip.kind === "row" ? ref.kind === "row" && clip.rowId === ref.rowId : ref.kind === "plugin" && clip.pluginId === ref.pluginId);
  const paste = clip && sameCell ? planPaste(state, clip, ref.hostId) : null;
  const differs = view.compare?.state === "differs" || view.compare?.state === "missing";
  const fromBaseline = differs && !view.staged ? copyFromBaseline(state, cellRef) : null;
  const installed = ref.kind === "plugin" && hostData(host)?.plugins.some((plugin) => plugin.id === ref.pluginId);
  const staged = view.staged;

  return (
    <Bar theme={theme} title={title} subtitle={view.unavailable ? view.unavailable.message : view.text}>
      {view.copyable ? <Button theme={theme} label="Copy" onPress={() => dispatch({ type: "copy", ref: cellRef })} /> : null}
      {fromBaseline?.ok ? (
        <Button
          theme={theme}
          variant="primary"
          label={fromBaseline.inputs[0]?.op === "installPlugin" ? "Install from baseline" : "Copy from baseline"}
          disabled={state.applying}
          onPress={() => dispatch({ type: "stage", inputs: fromBaseline.inputs })}
        />
      ) : null}
      {fromBaseline && !fromBaseline.ok && !fromBaseline.same ? <Reason theme={theme} text={`From baseline: ${fromBaseline.reason}`} /> : null}
      {paste?.ok && clip?.kind === "doc" ? (
        // The editor reads the target's document first, so masked secrets keep the target's own values.
        <Button
          theme={theme}
          variant="primary"
          label="Paste settings..."
          onPress={() => dispatch({ type: "openDialog", dialog: { kind: "editor", pluginId: clip.pluginId, settingsId: clip.settingsId, hostId: ref.hostId } })}
        />
      ) : paste?.ok ? (
        <Button theme={theme} variant="primary" label={paste.inputs[0]?.op === "installPlugin" ? "Install here" : "Paste"} onPress={() => dispatch({ type: "paste", hostId: ref.hostId })} />
      ) : null}
      {paste && !paste.ok && !paste.same ? <Reason theme={theme} text={paste.reason} /> : null}
      {ref.kind === "plugin" && host.result.ok && installed ? (
        <Button theme={theme} label="Actions..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "pluginMenu", pluginId: ref.pluginId, hostId: ref.hostId } })} />
      ) : null}
      {ref.kind === "plugin" && host.result.ok && !installed ? (
        <Button theme={theme} label="Install..." onPress={() => dispatch({ type: "openDialog", dialog: { kind: "install", pluginId: ref.pluginId, hostId: ref.hostId } })} />
      ) : null}
      {staged && !state.applying ? <Button theme={theme} label="Unstage" onPress={() => dispatch({ type: "unstage", id: staged.item.id })} /> : null}
      <Button theme={theme} label="Close" onPress={() => dispatch({ type: "select", ref: null })} />
    </Bar>
  );
}
