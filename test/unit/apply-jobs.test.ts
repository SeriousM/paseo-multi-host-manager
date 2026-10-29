import { describe, expect, it } from "vitest";
import { applyPollRpc, applyStartRpc } from "../../shared/contracts";
import type { ApplyItem, ApplyResult } from "../../shared/contracts";
import { APPLY_JOB_TTL_MS, ApplyJobs } from "../../server/rpc/apply-jobs";

const items: ApplyItem[] = [
  { id: "a", host: "W", op: "setRow", rowId: "mcp", value: false },
  { id: "b", host: "L", op: "setRow", rowId: "mcp", value: false },
];
const ok = (item: ApplyItem): ApplyResult => ({ id: item.id, host: item.host, op: item.op, outcome: { status: "ok" } });


describe("apply jobs", () => {
  it("reports items as they settle, then done with every result", async () => {
    const jobs = new ApplyJobs();
    const done = Promise.withResolvers<ApplyResult[]>();
    let report: (result: ApplyResult) => void = () => {};
    const started = jobs.start(items, (onSettle) => {
      report = onSettle;
      return done.promise;
    });
    if (!started.ok) throw new Error("not started");
    expect(applyStartRpc.output.parse(started)).toEqual(started);
    expect(jobs.poll(started.jobId)).toEqual({ state: "running", results: [] });
    report(ok(items[1]));
    expect(jobs.poll(started.jobId)).toEqual({ state: "running", results: [ok(items[1])] });
    done.resolve(items.map(ok));
    await jobs.idle();
    const view = jobs.poll(started.jobId);
    expect(applyPollRpc.output.parse(view)).toEqual({ state: "done", results: items.map(ok) });
  });

  it("refuses a second job while one runs, and allows one after it finished", async () => {
    const jobs = new ApplyJobs();
    const done = Promise.withResolvers<ApplyResult[]>();
    expect(jobs.start(items, () => done.promise).ok).toBe(true);
    expect(jobs.start(items, () => done.promise)).toEqual({ ok: false, reason: "busy" });
    done.resolve(items.map(ok));
    await jobs.idle();
    expect(jobs.start(items, async () => items.map(ok)).ok).toBe(true);
  });

  it("fails the unsettled items when the run throws, so nothing stays running", async () => {
    const jobs = new ApplyJobs();
    const done = Promise.withResolvers<ApplyResult[]>();
    let report: (result: ApplyResult) => void = () => {};
    const started = jobs.start(items, (onSettle) => {
      report = onSettle;
      return done.promise;
    });
    if (!started.ok) throw new Error("not started");
    report(ok(items[0]));
    done.reject(new Error("boom"));
    await jobs.idle();
    expect(jobs.poll(started.jobId)).toEqual({
      state: "done",
      results: [ok(items[0]), { id: "b", host: "L", op: "setRow", outcome: { status: "failed", error: expect.objectContaining({ code: "host_error" }) } }],
    });
  });

  it("answers unknown for a job it does not have, and drops finished jobs after the TTL", async () => {
    let now = 1_000;
    const jobs = new ApplyJobs(() => now);
    expect(jobs.poll("nope")).toEqual({ state: "unknown", results: [] });
    const started = jobs.start(items, async () => items.map(ok));
    if (!started.ok) throw new Error("not started");
    await jobs.idle();
    expect(jobs.poll(started.jobId).state).toBe("done");
    now += APPLY_JOB_TTL_MS + 1;
    expect(jobs.poll(started.jobId).state).toBe("unknown");
  });
});
