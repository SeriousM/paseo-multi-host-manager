import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Dispatch } from "react";
import { unencryptedLink } from "../../shared/connection";
import { applyPollRpc, applyStartRpc, docReadRpc, gridLoadRpc, hostAddRpc } from "../../shared/contracts";
import type { BrokerPolicy, HostFailure } from "../../shared/contracts";
import { DEFAULT_POLICY, brokerSettings } from "../../shared/policy";
import { runApply } from "./apply-run";
import { INITIAL_STATE, mhmReducer } from "./reducer";
import type { MhmAction } from "./reducer";
import { applyInput, nextConfirmation, SENDABLE } from "./staging";
import type { Confirmation, MhmState } from "./types";

/** Everything the screen's components get: state, dispatch, and the RPC-backed commands. */
export interface MhmController {
  state: MhmState;
  dispatch: Dispatch<MhmAction>;
  policy: BrokerPolicy;
  /** Saves the policy document on the hub; the grid reloads with it. Resolves false on a conflict or invalid values. */
  savePolicy: (next: BrokerPolicy) => Promise<boolean>;
  /** Why the defaults are in use although a policy document exists (saved by a newer version, unreadable); else null. */
  policyNote: string | null;
  grid: { loading: boolean; refreshing: boolean; error: string | null; refresh: () => void };
  /**
   * Apply button: opens the confirmation dialog that is still missing (lockout, destructive, trust), otherwise runs the
   * pending, failed and skipped items (`SENDABLE`) as a job on the hub (`runApply`) and reloads the grid afterwards.
   */
  apply: () => Promise<void>;
  /** Confirmation dialogs call this: marks the items, closes the dialog and continues Apply with the updated queue. */
  confirm: (kind: Confirmation, itemIds: string[]) => void;
  /** Reads a settings document (`mhm.doc.read`, secrets masked) and puts it on the clipboard. Resolves to an error text or null. */
  copyDoc: (hostId: string, pluginId: string, settingsId: string) => Promise<string | null>;
  /**
   * Saves a host on the hub (`mhm.hosts.add`), right away, not staged. On success it allows the host in the policy when
   * the user confirmed an unencrypted link, closes the dialog, reloads the grid and selects the new column. Resolves to
   * the failure, or null on success.
   */
  addHost: (input: { connection: string; label: string; allowUnencrypted: boolean }) => Promise<HostFailure | string | null>;
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
  const saveHost = useRpc(hostAddRpc);
  const settings = useSettings(brokerSettings);
  const policy = settings.status === "ready" ? settings.values : DEFAULT_POLICY;
  const policyNote =
    settings.status === "invalid" ? "Policy reset: saved by a newer version" : settings.status === "error" ? `Policy could not be read (${settings.error}); defaults in use` : null;
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
    await runApply(applyInput(state.staged, policy), {
      start: startApply,
      poll: pollApply,
      dispatch,
      // Executor form on purpose: Promise.withResolvers is ES2024 and not on every React Native engine.
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
    });
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

  const addHost = useCallback(
    async ({ connection, label, allowUnencrypted }: { connection: string; label: string; allowUnencrypted: boolean }) => {
      let result;
      try {
        result = await saveHost({ ...policy, connection, ...(label.trim() ? { label: label.trim() } : null), allowUnencrypted });
      } catch (error) {
        return message(error);
      }
      if (!result.ok) return result.error;
      const { registrationId, link } = result.host;
      dispatch({ type: "hostAdded", registrationId });
      // The user confirmed this link in the dialog: the grid reaches the host with the same policy as an allowed saved host.
      // A new policy reloads the grid by itself (it is part of the query key).
      if (allowUnencrypted && unencryptedLink(link) && !policy.insecureLinkRegistrationIds.includes(registrationId)) {
        if (await savePolicy({ ...policy, insecureLinkRegistrationIds: [...policy.insecureLinkRegistrationIds, registrationId] })) return null;
      }
      refresh();
      return null;
    },
    [policy, refresh, savePolicy, saveHost],
  );

  return {
    state,
    dispatch,
    policy,
    savePolicy,
    policyNote,
    grid: { loading: grid.isPending, refreshing: grid.isFetching, error: grid.error ? message(grid.error) : null, refresh },
    apply,
    confirm,
    copyDoc,
    addHost,
  };
}
