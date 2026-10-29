import type { HostFailure } from "../../shared/contracts";
import { failureText } from "../state/failure-text";
import { findHost } from "../state/grid-model";
import { itemOnHost } from "../state/staging";
import type { MhmState } from "../state/types";

export interface RemoveHostView {
  label: string;
  registrationId: string | null;
  /** Staged items for this host that removal drops from the queue. */
  staged: number;
  /** Why Remove is not offered right now; null when it is. */
  blocked: string | null;
}

export function removeHostView(state: MhmState, hostId: string): RemoveHostView | null {
  const host = findHost(state, hostId);
  if (!host) return null;
  const staged = state.staged.filter((entry) => itemOnHost(entry.item.host, host)).length;
  const blocked =
    host.isHub || host.registrationId === null
      ? "The hub is where this view runs; it cannot remove itself."
      : state.applying
        ? "An apply is running. Remove the host after it finished."
        : null;
  return { label: host.label, registrationId: host.registrationId, staged, blocked };
}

/** Text for a failed removal; the hub refusing itself gets its own sentence instead of the plugin-on-hub one. */
export function removeFailureText(error: HostFailure): string {
  if (error.code === "invalid_item" && error.detail === "self_target") return "The hub cannot remove itself.";
  return failureText(error);
}
