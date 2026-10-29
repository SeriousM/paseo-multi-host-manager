import { Text, View } from "react-native";
import { Button } from "../grid/primitives";
import type { MhmSurfaceProps } from "../surface";

/**
 * WP8a stub of the staging drawer (8b: the item list with per-item status and outcome, remove buttons, Retry).
 * Apply goes through `controller.apply`, which asks for missing confirmations first.
 */
export function StagingDrawer({ theme, controller }: Pick<MhmSurfaceProps, "theme" | "controller">) {
  const { state, dispatch } = controller;
  const { colors } = theme;
  if (state.staged.length === 0) return null;
  const failed = state.staged.filter((entry) => entry.status === "failed" || entry.status === "skipped").length;
  const applied = state.staged.filter((entry) => entry.status === "ok").length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 12 }}>Staged changes ({state.staged.length})</Text>
      {applied > 0 ? <Text style={{ color: colors.statusSuccess, fontSize: 11 }}>{applied} applied</Text> : null}
      {failed > 0 ? <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{failed} failed</Text> : null}
      <View style={{ flex: 1 }} />
      {applied > 0 ? <Button theme={theme} label="Clear applied" disabled={state.applying} onPress={() => dispatch({ type: "clearApplied" })} /> : null}
      <Button theme={theme} label="Discard all" disabled={state.applying} onPress={() => dispatch({ type: "discardAll" })} />
      <Button theme={theme} variant="primary" label={state.applying ? "Applying..." : failed > 0 ? "Retry failed" : "Apply"} disabled={state.applying} onPress={() => void controller.apply()} />
    </View>
  );
}
