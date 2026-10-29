import { describe, expect, it } from "vitest";
import type { ApplyJob, ApplyResult, ApplyStart, GridHostData } from "../../shared/contracts";
import { APPLY_POLL_MS, NOTE_BUSY, NOTE_LOST, POLL_GIVE_UP_MS, runApply } from "../../client/state/apply-run";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { MhmAction } from "../../client/state/reducer";
import { applyInput } from "../../client/state/staging";
import type { GridHost, MhmState } from "../../client/state/types";

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const data: GridHostData = { rows: {}, plugins: [], companion: { state: "missing" } };
const snapshot = { serverId: "x", version: "0.14.0", protocolVersion: 1, prerelease: false, features: [] };
const hosts: GridHost[] = [
  { id: "hub", registrationId: null, label: "hub", link: "loopback", isHub: true, result: { ok: true, snapshot, value: data } },
  { id: "a", registrationId: "reg-a", label: "a", link: "relay", isHub: false, result: { ok: true, snapshot, value: data } },
];
const result = (id: string): ApplyResult => ({ id, host: "reg-a", op: "setRow", outcome: { status: "ok" } });

type Step = ApplyJob | Error;

/** Runs an apply of two staged rows against scripted start and poll answers, on a fake clock that `sleep` advances. */
async function scripted(start: ApplyStart | Error, polls: Step[]) {
  let state: MhmState = mhmReducer(mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts }), {
    type: "stage",
    inputs: ["mcp", "sys"].map((rowId) => ({ op: "setRow", host: "reg-a", rowId, value: false })),
  });
  const actions: MhmAction["type"][] = [];
  const sleeps: number[] = [];
  let clock = 0;
  let polled = 0;
  await runApply(applyInput(state.staged, policy), {
    start: async () => {
      if (start instanceof Error) throw start;
      return start;
    },
    poll: async () => {
      // The last step repeats, so "keeps failing" needs one entry.
      const step = polls[Math.min(polled++, polls.length - 1)];
      if (step instanceof Error) throw step;
      return step;
    },
    dispatch: (action) => {
      actions.push(action.type);
      state = mhmReducer(state, action);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  });
  return { state, actions, sleeps, clock, polled, statuses: state.staged.map((entry) => entry.status) };
}

const started = { ok: true as const, jobId: "job" };

describe("runApply", () => {
  it("polls a job to the end and merges progress", async () => {
    const run = await scripted(started, [
      { state: "running", results: [result("reg-a/row:mcp")] },
      { state: "done", results: [result("reg-a/row:mcp"), result("reg-a/row:sys")] },
    ]);
    expect(run.actions).toEqual(["applyStarted", "applyProgress", "applyFinished"]);
    expect(run.statuses).toEqual(["ok", "ok"]);
    expect(run.state.applyNote).toBeNull();
  });

  it("stages the items again with a note when the hub is busy, and polls nothing", async () => {
    const run = await scripted({ ok: false, reason: "busy" }, []);
    expect(run.actions).toEqual(["applyStarted", "applyNotStarted"]);
    expect(run.statuses).toEqual(["pending", "pending"]);
    expect(run.state.applyNote).toBe(NOTE_BUSY);
    expect(run.polled).toBe(0);
  });

  it("stages the items again when the start call itself fails", async () => {
    const run = await scripted(new Error("socket closed"), []);
    expect(run.statuses).toEqual(["pending", "pending"]);
    expect(run.state.applyNote).toContain("socket closed");
    expect(run.polled).toBe(0);
  });

  it("retries failing polls with a growing delay and carries on when the hub answers again", async () => {
    const run = await scripted(started, [new Error("relay hiccup"), new Error("relay hiccup"), new Error("relay hiccup"), { state: "done", results: [result("reg-a/row:mcp"), result("reg-a/row:sys")] }]);
    expect(run.sleeps).toEqual([APPLY_POLL_MS, 2 * APPLY_POLL_MS, 4 * APPLY_POLL_MS, 8 * APPLY_POLL_MS]);
    expect(run.statuses).toEqual(["ok", "ok"]);
  });

  it("gives up after about 30 s of failing polls and marks the items unknown, not failed", async () => {
    const run = await scripted(started, [{ state: "running", results: [result("reg-a/row:mcp")] }, new Error("gone")]);
    expect(run.actions.at(-1)).toBe("applyLost");
    expect(run.statuses).toEqual(["ok", "unknown"]);
    expect(run.state.applyNote).toBe(NOTE_LOST);
    // First failure after the first poll; the loss is declared once the failures have lasted the give-up time.
    expect(run.clock - APPLY_POLL_MS * 2).toBeGreaterThanOrEqual(POLL_GIVE_UP_MS);
    expect(run.clock).toBeLessThan(APPLY_POLL_MS * 2 + POLL_GIVE_UP_MS + 8_000);
    expect(applyInput(run.state.staged, policy).items).toEqual([]);
  });

  it("marks the items unknown when the hub no longer knows the job", async () => {
    const run = await scripted(started, [{ state: "unknown", results: [] }]);
    expect(run.actions).toEqual(["applyStarted", "applyLost"]);
    expect(run.statuses).toEqual(["unknown", "unknown"]);
    expect(run.state.applyNote).toBe(NOTE_LOST);
  });
});
