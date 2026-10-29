import { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Badge, Button } from "../grid/primitives";
import { MONO, severityColor } from "../grid/palette";
import type { Severity } from "../grid/palette";
import { summarizePreview } from "./doc-preview";
import type { DocPreview, PreviewKind } from "./doc-preview";

const KIND_LABEL: Record<PreviewKind, { label: string; severity: Severity }> = {
  unchanged: { label: "same", severity: "muted" },
  changed: { label: "changed", severity: "accent" },
  added: { label: "new", severity: "ok" },
  removed: { label: "removed", severity: "bad" },
  kept: { label: "masked, kept", severity: "muted" },
  secretReplaced: { label: "secret replaced", severity: "warn" },
  secretAdded: { label: "secret new", severity: "warn" },
  secretRemoved: { label: "secret removed", severity: "bad" },
  unresolved: { label: "unresolved", severity: "bad" },
};

/**
 * What the write contains before it is staged: every key with what happens to it. Unchanged keys are folded into a count
 * (shown on request). Secret values never appear: stored ones read `<masked>`, typed ones `<secret>`.
 */
export function PreviewPanel({ theme, preview, notes }: { theme: PluginTheme; preview: DocPreview; notes: string[] }) {
  const [all, setAll] = useState(false);
  const { colors } = theme;
  const shown = preview.entries.filter((entry) => all || entry.kind !== "unchanged");
  return (
    <View style={{ gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 12 }}>{summarizePreview(preview)}</Text>
      {notes.map((note) => (
        <Text key={note} style={{ color: colors.statusWarning, fontSize: 11 }}>
          {note}
        </Text>
      ))}
      {preview.blocked ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{preview.blocked}</Text> : null}
      {shown.map((entry) => {
        const { label, severity } = KIND_LABEL[entry.kind];
        return (
          <View key={`${entry.kind}:${entry.path}`} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Badge theme={theme} label={label} severity={severity} />
              <Text style={{ ...MONO, color: colors.foreground, fontSize: 11, flexShrink: 1 }}>{entry.path === "" ? "(document)" : entry.path}</Text>
            </View>
            <Text style={{ ...MONO, color: severityColor(theme, severity), fontSize: 11, paddingLeft: 4 }}>
              {entry.before === null ? "" : entry.before}
              {entry.before !== null && entry.after !== null && entry.before !== entry.after ? "  ->  " : ""}
              {entry.after !== null && entry.before !== entry.after ? entry.after : ""}
            </Text>
          </View>
        );
      })}
      {preview.counts.unchanged > 0 ? (
        <View style={{ flexDirection: "row" }}>
          <Button theme={theme} label={all ? "Hide unchanged keys" : `Show ${preview.counts.unchanged} unchanged key${preview.counts.unchanged === 1 ? "" : "s"}`} onPress={() => setAll(!all)} />
        </View>
      ) : null}
    </View>
  );
}
