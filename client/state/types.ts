import type { z } from "zod";
import type { ApplyItem, ApplyOutcome, gridLoadRpc, GridPlugin } from "../../shared/contracts";
import type { Json } from "../../shared/mask";

/** One column of the grid: a host of the hub's directory with its `mhm.grid.load` result. */
export type GridHost = z.output<typeof gridLoadRpc.output>["hosts"][number];

/** A cell: a settings row, a plugin, or one settings document of a plugin, on one host. */
export type CellRef =
  | { kind: "row"; rowId: string; hostId: string }
  | { kind: "plugin"; pluginId: string; hostId: string }
  | { kind: "doc"; pluginId: string; settingsId: string; hostId: string };

/** What Copy put on the clipboard: the cell, the host it came from and its value at copy time. */
export type ClipboardEntry =
  | { kind: "row"; rowId: string; sourceHost: string; value: Json }
  | { kind: "plugin"; pluginId: string; sourceHost: string; plugin: GridPlugin }
  /** `values` come from `mhm.doc.read` (secrets masked); a write keeps the target's own value at every masked path. */
  | { kind: "doc"; pluginId: string; settingsId: string; sourceHost: string; version: number; values: Json; maskedPaths: string[] };

/** An apply item before it has an id; the id is derived from host and slot (see `slotOf`). */
type WithoutId<Item> = Item extends unknown ? Omit<Item, "id"> : never;
export type StageInput = WithoutId<ApplyItem>;

/** `unknown`: the apply job's result was lost (the hub stopped answering, or forgot the job); a grid reload shows the truth. */
export type StagedStatus = "pending" | "applying" | "ok" | "ignored" | "failed" | "skipped" | "unknown";

/**
 * Confirmations an item needs before Apply. `trust`: install runs unsandboxed code. `destructive`: removal deletes files
 * and settings. `lockout`: the item can cut the hub (and this view) off the host: relay off on a host reached over the
 * relay or on the hub, plugins off on any host, or removing/disabling this plugin on a remote.
 */
export type Confirmation = "trust" | "destructive" | "lockout";

export interface StagedItem {
  /** What goes to `mhm.apply.start`, without `confirmed`: `applyInput` adds it once every required confirmation is given. */
  item: ApplyItem;
  status: StagedStatus;
  /** The last apply outcome; null until the item was applied once. */
  outcome: ApplyOutcome | null;
  requires: Confirmation[];
  confirmed: Confirmation[];
}

/**
 * A settings document this session wrote or restored. The plugin was not asked whether it accepts the values, so the
 * editor and the plugin cell say "validity unknown" until the plugin is reloaded or the user dismisses it; the marker
 * outlives `clearApplied`.
 */
export interface WrittenDoc {
  /** The apply item's host reference (registration id, or the hub's id). */
  host: string;
  pluginId: string;
  settingsId: string;
  op: "writeSettingsDoc" | "restoreSettingsDoc";
  keptMaskedPaths: string[];
  backedUp: boolean;
}

/**
 * A plugin a check-only update found an update for. Shown on the plugin cell while the host still reports the version
 * it had at the check; Refresh forgets it.
 */
export interface UpdateCheck {
  /** The apply item's host reference. */
  host: string;
  pluginId: string;
  version: string | null;
}

/** A dialog the screen shows; 8b/8c own the components, the state only says which one is open. */
export type DialogRequest =
  /** Trust confirmation for the staged installs (item ids). */
  | { kind: "trust"; itemIds: string[] }
  /** Destructive confirmation for the staged removals (item ids). */
  | { kind: "destructive"; itemIds: string[] }
  /** Lockout confirmation for items that can cut the hub off a host (see `Confirmation`). */
  | { kind: "lockout"; itemIds: string[] }
  | { kind: "capabilities"; hostId: string }
  /** Per-plugin actions on one host (enable/disable, update, remove, edit settings). */
  | { kind: "pluginMenu"; pluginId: string; hostId: string }
  /** Install a plugin on hosts; `hostId` preselects one. */
  | { kind: "install"; pluginId: string; hostId: string | null }
  /** Remove a plugin from hosts; `hostId` preselects one. */
  | { kind: "remove"; pluginId: string; hostId: string | null }
  /** Settings-document editor (8c). */
  | { kind: "editor"; pluginId: string; settingsId: string; hostId: string }
  /** Save a new host on the hub (a direct action, not staged). */
  | { kind: "addHost" }
  /** Remove a saved host from the hub (a direct action, not staged; destructive confirmation). */
  | { kind: "removeHost"; hostId: string }
  /** Set a saved host's daemon password (its link again plus the password; direct, not staged). */
  | { kind: "setPassword"; hostId: string };

export type ViewMode = "auto" | "grid" | "compact";

/** What the action bar acts on: a cell, or a host (its header was tapped). */
export type Selection = CellRef | { kind: "host"; hostId: string };

export interface MhmState {
  /** Hub first, then the hub's saved hosts in directory order. */
  hosts: GridHost[];
  selection: Selection | null;
  clipboard: ClipboardEntry | null;
  /** Hosts picked in the clipboard bar for "paste to several hosts". */
  pasteTargets: string[];
  staged: StagedItem[];
  writtenDocs: WrittenDoc[];
  updateChecks: UpdateCheck[];
  applying: boolean;
  /** Why the last Apply did not start, or that its result was lost; shown in the drawer until the next Apply. */
  applyNote: string | null;
  dialog: DialogRequest | null;
  view: ViewMode;
  /** Compact view: host that receives (`into`) and host that is pulled from. */
  compare: { into: string | null; from: string | null };
  /** Host every other host is compared with, by reference (registration id, or the hub's id); null for none. */
  baseline: string | null;
  /** Hide rows where every comparable host equals the baseline. */
  onlyDifferences: boolean;
  /** Registration id of a host Add host saved; its column is selected once a grid load has it. */
  focusHost: string | null;
}
