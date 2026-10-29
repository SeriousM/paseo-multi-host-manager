import type { ApplyInput, ApplyJob, ApplyStart } from "../../shared/contracts";
import type { MhmAction } from "./reducer";

/**
 * How often a running apply is polled. A plugin RPC has 30 s on the daemon, less than an install may take, so Apply
 * starts a job on the hub (`mhm.apply.start`) and polls it (`mhm.apply.poll`) instead of waiting on one call.
 */
export const APPLY_POLL_MS = 1_000;
/** Failing polls are retried with a doubling delay up to this cap... */
const POLL_BACKOFF_MAX_MS = 8_000;
/** ...for this long after the first failure; then the result counts as lost. A relay hiccup or a plugin reload fits in it. */
export const POLL_GIVE_UP_MS = 30_000;

export const NOTE_BUSY = "Another apply is still running on the hub. Nothing was sent; wait for it to finish, then apply again.";
export const NOTE_LOST = "Result lost; reload the grid before retrying.";

export interface ApplyRunDeps {
  start: (input: ApplyInput) => Promise<ApplyStart>;
  poll: (input: { jobId: string }) => Promise<ApplyJob>;
  dispatch: (action: MhmAction) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Runs one apply: starts the job and polls it to the end, reporting through `apply*` actions. Nothing here marks an
 * item `failed`: only a host's own result does. A job that did not start leaves the items staged; a job whose result
 * is lost leaves them `unknown`, so Retry cannot send a change twice that may already have run.
 */
export async function runApply(input: ApplyInput, deps: ApplyRunDeps): Promise<void> {
  deps.dispatch({ type: "applyStarted" });
  let started: ApplyStart;
  try {
    started = await deps.start(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.dispatch({ type: "applyNotStarted", note: `The hub did not take the apply (${reason}). The changes are staged again.` });
    return;
  }
  if (!started.ok) {
    deps.dispatch({ type: "applyNotStarted", note: NOTE_BUSY });
    return;
  }
  let delay = APPLY_POLL_MS;
  let failingSince: number | null = null;
  for (;;) {
    await deps.sleep(delay);
    let job: ApplyJob;
    try {
      job = await deps.poll({ jobId: started.jobId });
    } catch {
      failingSince ??= deps.now();
      if (deps.now() - failingSince >= POLL_GIVE_UP_MS) {
        deps.dispatch({ type: "applyLost", note: NOTE_LOST });
        return;
      }
      delay = Math.min(delay * 2, POLL_BACKOFF_MAX_MS);
      continue;
    }
    delay = APPLY_POLL_MS;
    failingSince = null;
    if (job.state === "unknown") {
      // The hub's plugin restarted or the job expired: whatever ran is on the hosts, the results are gone.
      deps.dispatch({ type: "applyLost", note: NOTE_LOST });
      return;
    }
    if (job.state === "done") {
      deps.dispatch({ type: "applyFinished", results: job.results });
      return;
    }
    deps.dispatch({ type: "applyProgress", results: job.results });
  }
}
