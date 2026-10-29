import { randomUUID } from "node:crypto";
import type { ApplyItem, ApplyResult } from "../../shared/contracts";
import { hostFailure } from "../broker/failures";

/** A finished job is kept this long for the last poll, then dropped. */
export const APPLY_JOB_TTL_MS = 10 * 60_000;

interface Job {
  items: ApplyItem[];
  /** Settled results by item index. */
  results: (ApplyResult | undefined)[];
  finishedAt: number | null;
}

export type ApplyJobView = { state: "running" | "done" | "unknown"; results: ApplyResult[] };

/**
 * Apply jobs of this plugin instance. `run` does the work and reports each item as it settles; the jobs only keep
 * the results for polling. One job runs at a time, because the hub serializes host calls anyway and a second batch
 * could race the first one on the same host.
 */
export class ApplyJobs {
  readonly #jobs = new Map<string, Job>();
  #running: Promise<void> = Promise.resolve();

  constructor(private readonly now: () => number = Date.now) {}

  start(items: ApplyItem[], run: (onSettle: (result: ApplyResult) => void) => Promise<ApplyResult[]>): { ok: true; jobId: string } | { ok: false; reason: "busy" } {
    this.#prune();
    if ([...this.#jobs.values()].some((job) => job.finishedAt === null)) return { ok: false, reason: "busy" };
    const jobId = randomUUID();
    const job: Job = { items, results: items.map(() => undefined), finishedAt: null };
    this.#jobs.set(jobId, job);
    const record = (result: ApplyResult) => {
      const index = items.findIndex((item) => item.id === result.id);
      if (index >= 0) job.results[index] = result;
    };
    this.#running = run(record)
      .then((results) => results.forEach(record))
      .catch(() => {
        // `applyItems` does not throw; if it ever does, nothing may stay "running" forever.
        items.forEach((item, index) => (job.results[index] ??= { id: item.id, host: item.host, op: item.op, outcome: { status: "failed", error: hostFailure("host_error") } }));
      })
      .finally(() => {
        job.finishedAt = this.now();
      });
    return { ok: true, jobId };
  }

  /** Resolves when the current job (if any) has finished and its results are recorded. */
  idle(): Promise<void> {
    return this.#running;
  }

  poll(jobId: string): ApplyJobView {
    this.#prune();
    const job = this.#jobs.get(jobId);
    if (!job) return { state: "unknown", results: [] };
    return { state: job.finishedAt === null ? "running" : "done", results: job.results.filter((result) => result !== undefined) };
  }

  #prune() {
    for (const [jobId, job] of this.#jobs) if (job.finishedAt !== null && this.now() - job.finishedAt > APPLY_JOB_TTL_MS) this.#jobs.delete(jobId);
  }
}
