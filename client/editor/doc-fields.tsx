import { TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { MASK_PLACEHOLDER, maskJson } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { Badge, Button } from "../grid/primitives";
import { font, MONO, TYPE } from "../grid/palette";
import { flattenDoc, removeAt, setAt } from "./doc-tree";
import type { Leaf } from "./doc-tree";

interface FieldsProps {
  theme: PluginTheme;
  draft: Json;
  /** Paths the host stores as secrets (masked in the read). */
  maskedPaths: readonly string[];
  /** Placeholders the host has no value for. */
  unresolvedPaths: readonly string[];
  onChange: (next: Json) => void;
}

function NumberField({ theme, value, onChange }: { theme: PluginTheme; value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));
  const valid = text.trim() !== "" && Number.isFinite(Number(text));
  return (
    <TextInput
      value={text}
      keyboardType="numeric"
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={(next) => {
        setText(next);
        if (next.trim() !== "" && Number.isFinite(Number(next))) onChange(Number(next));
      }}
      style={{ ...MONO, color: valid ? theme.colors.foreground : theme.colors.statusDanger, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, ...font(TYPE.mono) }}
    />
  );
}

interface FieldRowProps {
  theme: PluginTheme;
  leaf: Leaf;
  stored: boolean;
  secret: boolean;
  unresolved: boolean;
  onSet: (next: Json) => void;
  onRemove: (() => void) | null;
}

function FieldRow({ theme, leaf, stored, secret, unresolved, onSet, onRemove }: FieldRowProps) {
  const { colors } = theme;
  const { value } = leaf;
  const input = { ...MONO, color: colors.foreground, borderColor: colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, ...font(TYPE.mono) };
  let control;
  if (value === MASK_PLACEHOLDER) {
    control = (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ ...MONO, ...font(TYPE.mono), color: unresolved ? colors.statusDanger : colors.foregroundMuted }}>
          {unresolved ? "<masked> (nothing stored on this host)" : "<masked> (kept as on target)"}
        </Text>
        <Badge theme={theme} label="locked" severity={unresolved ? "bad" : "muted"} />
        {unresolved ? null : <Button theme={theme} label="Replace" onPress={() => onSet("")} />}
      </View>
    );
  } else if (typeof value === "string") {
    control = (
      <View style={{ gap: 4 }}>
        <TextInput
          value={value}
          onChangeText={onSet}
          secureTextEntry={secret}
          placeholder={stored ? "new value" : undefined}
          placeholderTextColor={colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={!secret && value.length > 60}
          style={input}
        />
        {stored ? <Button theme={theme} label="Keep stored value" onPress={() => onSet(MASK_PLACEHOLDER)} /> : null}
      </View>
    );
  } else if (typeof value === "boolean") {
    control = <Button theme={theme} label={value ? "true" : "false"} active={value} onPress={() => onSet(!value)} />;
  } else if (typeof value === "number") {
    control = <NumberField theme={theme} value={value} onChange={onSet} />;
  } else {
    control = <Text style={{ ...MONO, ...font(TYPE.mono), color: colors.foregroundMuted }}>{JSON.stringify(value)} (edit in the JSON view)</Text>;
  }
  return (
    <View style={{ gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ ...MONO, color: colors.foreground, ...font(TYPE.mono), flexShrink: 1 }}>{leaf.path === "" ? "(document)" : leaf.path}</Text>
        {secret ? <Badge theme={theme} label="secret" severity="warn" /> : null}
        <View style={{ flex: 1 }} />
        {onRemove ? <Button theme={theme} label="Remove" variant="danger" onPress={onRemove} /> : null}
      </View>
      {control}
    </View>
  );
}

/** The document as a list of its leaf values; masked ones are locked (replace or keep), everything else is editable in place. */
export function DocFields({ theme, draft, maskedPaths, unresolvedPaths, onChange }: FieldsProps) {
  const leaves = flattenDoc(draft);
  const draftSecret = maskJson(draft).maskedPaths;
  if (leaves.length === 0) return <Text style={{ color: theme.colors.foregroundMuted, ...font(TYPE.body) }}>The document is empty.</Text>;
  return (
    <View>
      {leaves.map((leaf) => {
        const removable = typeof leaf.segments[leaf.segments.length - 1] === "string";
        return (
          <FieldRow
            key={leaf.path}
            theme={theme}
            leaf={leaf}
            stored={maskedPaths.includes(leaf.path)}
            secret={maskedPaths.includes(leaf.path) || draftSecret.includes(leaf.path)}
            unresolved={unresolvedPaths.includes(leaf.path)}
            onSet={(next) => onChange(setAt(draft, leaf.segments, next))}
            onRemove={removable ? () => onChange(removeAt(draft, leaf.segments)) : null}
          />
        );
      })}
    </View>
  );
}
