import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Dispatch } from "react";
import { applyPollRpc, applyStartRpc, docReadRpc, gridLoadRpc } from "../../shared/contracts";
import type { BrokerPolicy } from "../../shared/contracts";
import { DEFAULT_POLICY, brokerSettings } from "../../shared/policy";
import { INITIAL_STATE, mhmReducer } from "./reducer";
import type { MhmAction } from "./reducer";
import { applyInput, nextConfirmation, SENDABLE } from "./staging";
import type { Confirmation, MhmState } from "./types";

/**
 * How often a running apply is polled. A plugin RPC has 30 s on the daemon, less than an install may take, so Apply
 * starts a job on the hub (`mhm.apply.start`) and polls it (`mhm.apply.poll`) instead of waiting on one call.
 */
const APPLY_POLL_MS = 1_000;

/** Everything the screen's components get: state, dispatch, and the RPC-backed commands. */
export interface MhmController {
  state: MhmState;
  dispatch: Dispatch<MhmAction>;
  policy: BrokerPolicy;
  /** Saves the policy document on the hub; the grid reloads with it. Resolves false on a conflict or invalid values. */
  savePolicy: (next: BrokerPolicy) => Promise<boolean>;
  grid: { loading: boolean; refreshing: boolean; error: string | null; refresh: () => void };
  /**
   * Apply button: opens the confirmation dialog that is still missing (lockout, destructive, trust), otherwise sends
   * the pending, failed and skipped items (`SENDABLE`) to `mhm.apply` and reloads the grid afterwards.
   */
  apply: () => Promise<void>;
  /** Confirmation dialogs call this: marks the items, closes the dialog and continues Apply with the updated queue. */
  confirm: (kind: Confirmation, itemIds: string[]) => void;
  /** Reads a settings document (`mhm.doc.read`, secrets masked) and puts it on the clipboard. Resolves to an error text or null. */
  copyDoc: (hostId: string, pluginId: string, settingsId: string) => Promise<string | null>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `hostId` is the host the screen is bound to (the hub); the query cache is keyed by it. */
export function useMhm(hostId: string): MhmController {
  const loadGrid = useRpc(gridLoadRpc);
  const startApply = useRpc(applyStartRpc);
  const pollApply = useRpc(applyPollRpc);
  const readDoc = useRpc(docReadRpc);
  const settings = useSettings(brokerSettings);
  const policy = settings.status === "ready" ? settings.values : DEFAULT_POLICY;
  const [state, dispatch] = useReducer(mhmReducer, INITIAL_STATE);

  const grid = useQuery({
    queryKey: ["mhm", hostId, "grid", policy],
    enabled: settings.status !== "loading",
    queryFn: () => loadGrid(policy),
    // Host state changes when the user acts; refetch on Refresh and after Apply only.
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (grid.data) dispatch({ type: "gridLoaded", hosts: grid.data.hosts });
  }, [grid.data]);

  const { refetch } = grid;
  const refresh = useCallback(() => void refetch(), [refetch]);

  const apply = useCallback(async () => {
    if (state.applying || !state.staged.some((entry) => SENDABLE.includes(entry.status))) return;
    const dialog = nextConfirmation(state.staged);
    if (dialog) {
      dispatch({ type: "openDialog", dialog });
      return;
    }
    dispatch({ type: "applyStarted" });
    try {
      const started = await startApply(applyInput(state.staged, policy));
      if (!started.ok) throw new Error("Another apply is still running on the hub. Wait for it, then retry.");
      for (;;) {
        // Executor form on purpose: Promise.withResolvers is ES2024 and not on every React Native engine.
        await new Promise<void>((resolve) => setTimeout(resolve, APPLY_POLL_MS));
        const job = await pollApply({ jobId: started.jobId });
        if (job.state === "unknown") throw new Error("The hub lost this apply (its plugin restarted). Reload the grid to see what changed.");
        if (job.state === "done") {
          dispatch({ type: "applyFinished", results: job.results });
          break;
        }
        dispatch({ type: "applyProgress", results: job.results });
      }
    } catch (error) {
      dispatch({ type: "applyFailed", message: message(error) });
    }
    void refetch();
  }, [policy, pollApply, refetch, startApply, state.applying, state.staged]);

  // `apply` closes over the queue of its render, so the continuation runs after the confirmation is in the state.
  const continueApply = useRef(false);
  const confirm = useCallback((kind: Confirmation, itemIds: string[]) => {
    dispatch({ type: "confirm", ids: itemIds, kind });
    dispatch({ type: "closeDialog" });
    continueApply.current = true;
  }, []);
  useEffect(() => {
    if (!continueApply.current) return;
    continueApply.current = false;
    void apply();
  }, [apply]);

  const copyDoc = useCallback(
    async (docHost: string, pluginId: string, settingsId: string) => {
      try {
        const result = await readDoc({ ...policy, host: docHost, pluginId, settingsId });
        if (!result.ok) return result.error.message;
        if (!result.value.ok) return result.value.message;
        const { version, values, maskedPaths } = result.value;
        if (version === null || values === null) return "The host has no such settings document";
        dispatch({ type: "copyDoc", entry: { kind: "doc", pluginId, settingsId, sourceHost: docHost, version, values, maskedPaths } });
        return null;
      } catch (error) {
        return message(error);
      }
    },
    [policy, readDoc],
  );

  const savePolicy = useCallback(
    (next: BrokerPolicy) => (settings.status === "ready" || settings.status === "invalid" ? settings.save(next, settings.revision) : Promise.resolve(false)),
    [settings],
  );

  return {
    state,
    dispatch,
    policy,
    savePolicy,
    grid: { loading: grid.isPending, refreshing: grid.isFetching, error: grid.error ? message(grid.error) : null, refresh },
    apply,
    confirm,
    copyDoc,
  };
}
