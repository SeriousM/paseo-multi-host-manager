import type { ApplyResult } from "../../shared/contracts";
import { clipFromCell, pasteTargetsInputs, planPaste } from "./clipboard";
import { orderHosts } from "./grid-model";
import { confirmItems, itemOnHost, markApplying, stageItems, withApplyError, withResults, withWrittenDocs } from "./staging";
import type { CellRef, ClipboardEntry, Confirmation, DialogRequest, GridHost, MhmState, StageInput, ViewMode } from "./types";

export type MhmAction =
  | { type: "gridLoaded"; hosts: GridHost[] }
  | { type: "select"; ref: CellRef | null }
  /** Copies a row or plugin cell; does nothing for a cell without a copyable value. */
  | { type: "copy"; ref: CellRef }
  /** Copies a settings document with the values `mhm.doc.read` returned. */
  | { type: "copyDoc"; entry: Extract<ClipboardEntry, { kind: "doc" }> }
  | { type: "clearClipboard" }
  | { type: "togglePasteTarget"; hostId: string }
  | { type: "setPasteTargets"; hostIds: string[] }
  /** Pastes the clipboard onto one host (the selected cell's host in the action bar). */
  | { type: "paste"; hostId: string }
  /** Pastes the clipboard onto every host in `pasteTargets`, then clears them. */
  | { type: "pasteTargets" }
  | { type: "stage"; inputs: StageInput[] }
  | { type: "unstage"; id: string }
  | { type: "discardAll" }
  | { type: "confirm"; ids: string[]; kind: Confirmation }
  | { type: "applyStarted" }
  | { type: "applyFinished"; results: ApplyResult[] }
  | { type: "applyFailed"; message: string }
  /** Drops the applied items; failed, skipped, ignored and unknown ones stay for Retry or removal. */
  | { type: "clearApplied" }
  /** Hides the "written, validity unknown" marker of one document (the user checked the plugin himself). */
  | { type: "dismissWritten"; host: string; pluginId: string; settingsId: string }
  | { type: "openDialog"; dialog: DialogRequest }
  | { type: "closeDialog" }
  | { type: "setView"; view: ViewMode }
  | { type: "setCompare"; into?: string | null; from?: string | null };

export const INITIAL_STATE: MhmState = {
  hosts: [],
  selection: null,
  clipboard: null,
  pasteTargets: [],
  staged: [],
  writtenDocs: [],
  applying: false,
  dialog: null,
  view: "auto",
  compare: { into: null, from: null },
};

function withStaged(state: MhmState, inputs: readonly StageInput[]): MhmState {
  return { ...state, staged: stageItems(state.staged, state.hosts, inputs) };
}

/** Pure state transitions of the screen. RPCs run in hooks.ts and report back through `gridLoaded` and `apply*`. */
export function mhmReducer(state: MhmState, action: MhmAction): MhmState {
  switch (action.type) {
    case "gridLoaded": {
      const hosts = orderHosts(action.hosts);
      // A saved host's id flips from its registration id to its server id once the hub reached it: follow the flip,
      // and drop references to hosts that are gone.
      const current = (hostId: string | null) => (hostId === null ? null : (hosts.find((host) => itemOnHost(hostId, host))?.id ?? null));
      const selectionHost = current(state.selection?.hostId ?? null);
      const sourceHost = current(state.clipboard?.sourceHost ?? null);
      const into = current(state.compare.into) ?? hosts.find((host) => host.isHub)?.id ?? null;
      const from = current(state.compare.from) ?? hosts.find((host) => host.id !== into)?.id ?? null;
      return {
        ...state,
        hosts,
        selection: state.selection && selectionHost ? { ...state.selection, hostId: selectionHost } : null,
        clipboard: state.clipboard && sourceHost ? { ...state.clipboard, sourceHost } : null,
        pasteTargets: state.pasteTargets.flatMap((hostId) => current(hostId) ?? []),
        compare: { into, from },
      };
    }
    case "select":
      return { ...state, selection: action.ref };
    case "copy": {
      const entry = clipFromCell(state, action.ref);
      return entry ? { ...state, clipboard: entry, pasteTargets: [] } : state;
    }
    case "copyDoc":
      return { ...state, clipboard: action.entry, pasteTargets: [] };
    case "clearClipboard":
      return { ...state, clipboard: null, pasteTargets: [] };
    case "togglePasteTarget": {
      const on = state.pasteTargets.includes(action.hostId);
      return { ...state, pasteTargets: on ? state.pasteTargets.filter((id) => id !== action.hostId) : [...state.pasteTargets, action.hostId] };
    }
    case "setPasteTargets":
      return { ...state, pasteTargets: action.hostIds };
    case "paste": {
      if (!state.clipboard) return state;
      const plan = planPaste(state, state.clipboard, action.hostId);
      return plan.ok ? withStaged(state, plan.inputs) : state;
    }
    case "pasteTargets":
      return { ...withStaged(state, pasteTargetsInputs(state)), pasteTargets: [] };
    case "stage":
      return withStaged(state, action.inputs);
    case "unstage":
      return state.applying ? state : { ...state, staged: state.staged.filter((entry) => entry.item.id !== action.id) };
    case "discardAll":
      return state.applying ? state : { ...state, staged: [] };
    case "confirm":
      return { ...state, staged: confirmItems(state.staged, action.ids, action.kind) };
    case "applyStarted":
      return { ...state, applying: true, staged: markApplying(state.staged) };
    case "applyFinished":
      return { ...state, applying: false, staged: withResults(state.staged, action.results), writtenDocs: withWrittenDocs(state.writtenDocs, state.staged, action.results) };
    case "applyFailed":
      return { ...state, applying: false, staged: withApplyError(state.staged, state.hosts, action.message) };
    case "clearApplied":
      return { ...state, staged: state.staged.filter((entry) => entry.status !== "ok") };
    case "dismissWritten":
      return {
        ...state,
        writtenDocs: state.writtenDocs.filter((doc) => !(doc.host === action.host && doc.pluginId === action.pluginId && doc.settingsId === action.settingsId)),
      };
    case "openDialog":
      return { ...state, dialog: action.dialog };
    case "closeDialog":
      return { ...state, dialog: null };
    case "setView":
      return { ...state, view: action.view };
    case "setCompare":
      return { ...state, compare: { into: action.into === undefined ? state.compare.into : action.into, from: action.from === undefined ? state.compare.from : action.from } };
  }
}
