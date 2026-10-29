import { planPaste } from "../state/clipboard";
import type { MhmState } from "../state/types";

export interface PasteChip {
  hostId: string;
  label: string;
  /** The paste would stage something on this host. */
  selectable: boolean;
  /** Picked for "paste to several hosts" (only ever true for a selectable chip). */
  selected: boolean;
  /** Install, update or paste: shown after the label. */
  tag: string | null;
  /** What the paste would do, or why it cannot. */
  note: string;
  /** Nothing would change (identical value): quieter than a real refusal. */
  same: boolean;
}

/** One chip per host except the one copied from, each with its `planPaste` result. */
export function pasteChips(state: Pick<MhmState, "hosts" | "staged" | "clipboard" | "pasteTargets">): PasteChip[] {
  const clip = state.clipboard;
  if (!clip) return [];
  return state.hosts
    .filter((host) => host.id !== clip.sourceHost)
    .map((host) => {
      const plan = planPaste(state, clip, host.id);
      if (!plan.ok) return { hostId: host.id, label: host.label, selectable: false, selected: false, tag: null, note: plan.reason, same: plan.same };
      const op = plan.inputs[0]?.op;
      const tag = op === "installPlugin" ? "install" : null;
      return { hostId: host.id, label: host.label, selectable: true, selected: state.pasteTargets.includes(host.id), tag, note: plan.note, same: false };
    });
}

/** Ids "All other hosts" selects: every selectable chip, or none when they are all selected already. */
export function allOthersSelection(chips: readonly PasteChip[]): string[] {
  const selectable = chips.filter((chip) => chip.selectable);
  return selectable.length > 0 && selectable.every((chip) => chip.selected) ? [] : selectable.map((chip) => chip.hostId);
}
