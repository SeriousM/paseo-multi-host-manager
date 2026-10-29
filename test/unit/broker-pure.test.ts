import { describe, expect, it } from "vitest";
import { capabilitySnapshot, checkGates } from "../../server/broker/capabilities";
import { patchConfigVerified } from "../../server/broker/config-patch";
import { DaemonAuthenticationError } from "../../server/broker/daemon-client";
import { failureFromCode, failureFromError } from "../../server/broker/failures";
import { classifyLink, hostEntries } from "../../server/broker/hosts";
import { codedError, fakeClient, savedHost, SECRETS, serverInfo } from "./broker-fakes";

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };

describe("classifyLink", () => {
  it.each([
    [`relay://${SECRETS.relayEndpoint}:443/srv_W`, "relay"],
    ["ssh://box.example:2222 (daemon port 6767)", "ssh"],
    ["unix:///home/u/.paseo/paseo.sock", "loopback"],
    ["pipe://paseo", "loopback"],
    ["tcp://127.0.0.1:6768", "loopback"],
    ["tcp://localhost:6768", "loopback"],
    ["tcp://[::1]:6768", "loopback"],
    ["ws://127.0.0.1:6768", "loopback"],
    [`tcp://${SECRETS.tcpHost}:6768`, "tcp-plain"],
    ["ws://box.lan:6767", "tcp-plain"],
    ["wss://box.example", "tls"],
    ["wss://127.0.0.1:6768", "tls"],
    ["http://box.example", "unknown"],
    ["something else", "unknown"],
  ])("%s -> %s", (description, kind) => {
    expect(classifyLink(description)).toBe(kind);
  });
});

describe("hostEntries", () => {
  it("puts the hub first and maps directory status without exposing the target", () => {
    const entries = hostEntries({
      self: { serverId: "srv_hub", label: "hub" },
      hosts: [
        savedHost("srv_ok", `relay://${SECRETS.relayEndpoint}:443/srv_ok`),
        savedHost("srv_pw", "tcp://127.0.0.1:6769", { status: "error", error: { code: "authentication_failed", message: "Incorrect password" } }),
        savedHost("srv_off", "tcp://127.0.0.1:6770", { status: "disabled", enabled: false }),
        savedHost(null, "tcp://127.0.0.1:6771", { status: "connecting" }),
        savedHost("srv_odd", "tcp://127.0.0.1:6772", { status: "error", error: { code: "server_id_mismatch", message: "x" } }),
      ],
    });
    expect(entries.map((entry) => [entry.id, entry.isHub, entry.link, entry.unavailable?.code ?? null])).toEqual([
      ["srv_hub", true, "loopback", null],
      ["srv_ok", false, "relay", null],
      ["srv_pw", false, "loopback", "authentication_failed"],
      ["srv_off", false, "loopback", "host_offline"],
      ["reg_new", false, "loopback", "host_offline"],
      ["srv_odd", false, "loopback", "host_error"],
    ]);
    expect(entries[5].unavailable?.detail).toBe("server_id_mismatch");
    expect(entries.map((entry) => entry.registrationId)).toEqual([null, "reg_srv_ok", "reg_srv_pw", "reg_srv_off", "reg_new", "reg_srv_odd"]);
    expect(JSON.stringify(entries)).not.toContain(SECRETS.relayEndpoint);
  });
});

describe("capability gates", () => {
  const gate = (version: string | null, features?: string[], allowPrerelease = false) =>
    checkGates(capabilitySnapshot(serverInfo("srv", version, features)), { ...policy, allowPrerelease }, ["connectedHosts"])?.code ?? null;

  it("builds the snapshot from server_info", () => {
    expect(capabilitySnapshot(serverInfo("srv", "0.14.0-beta.2", ["b", "a"]))).toEqual({
      serverId: "srv",
      version: "0.14.0-beta.2",
      protocolVersion: 3,
      prerelease: true,
      features: ["a", "b"],
    });
  });

  it("passes supported stable versions", () => {
    expect(gate("0.13.0")).toBeNull();
    expect(gate("0.13.2")).toBeNull();
    expect(gate("1.0.0")).toBeNull();
  });

  it("rejects versions below the minimum or unparseable", () => {
    expect(gate("0.12.9")).toBe("below_minimum");
    expect(gate("0.9.99")).toBe("below_minimum");
    expect(gate(null)).toBe("below_minimum");
    expect(gate("latest")).toBe("below_minimum");
  });

  it("blocks pre-releases unless allowed", () => {
    expect(gate("0.14.0-beta.2")).toBe("prerelease_blocked");
    expect(gate("0.14.0-beta.2", undefined, true)).toBeNull();
    expect(gate("0.12.0-beta.1", undefined, true)).toBe("below_minimum");
  });

  it("reports a missing required feature", () => {
    const failure = checkGates(capabilitySnapshot(serverInfo("srv", "0.13.2", ["plugins"])), policy, ["connectedHosts"]);
    expect(failure).toMatchObject({ code: "unsupported_capability", detail: "connectedHosts" });
  });
});

describe("failure mapping", () => {
  it("maps auth errors to authentication_failed", () => {
    expect(failureFromError(new DaemonAuthenticationError("incorrect_password"), "host_offline")).toMatchObject({
      code: "authentication_failed",
      detail: "incorrect_password",
    });
    expect(failureFromCode("authentication_failed", "host_error").code).toBe("authentication_failed");
  });

  it("maps unreachable codes to host_offline", () => {
    for (const code of ["host_offline", "host_disabled", "DAEMON_CONNECTION_LOST", "DAEMON_REQUEST_TIMEOUT", "ECONNREFUSED"]) {
      expect(failureFromError(codedError("x", code), "host_error")).toMatchObject({ code: "host_offline", detail: code });
    }
  });

  it("passes unsupported_capability through and falls back for anything else", () => {
    expect(failureFromCode("unsupported_capability", "host_error").code).toBe("unsupported_capability");
    expect(failureFromError(new Error("boom"), "host_offline")).toEqual({ code: "host_offline", message: expect.any(String) });
    expect(failureFromError(codedError("boom", "resource_limit"), "host_error")).toMatchObject({ code: "host_error", detail: "resource_limit" });
  });

  it("never copies error messages and drops codes that do not look like identifiers", () => {
    const leak = `tcp://admin:${SECRETS.password}@${SECRETS.tcpHost}:6768`;
    const failure = failureFromError(codedError(leak, leak), "host_error");
    expect(failure.detail).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(SECRETS.password);
    expect(JSON.stringify(failure)).not.toContain(SECRETS.tcpHost);
  });
});

describe("patchConfigVerified", () => {
  it("reports leaves the daemon ignored", async () => {
    const fake = fakeClient({
      info: null,
      config: { mcp: { injectIntoAgents: true }, autoArchiveAfterMerge: false, appendSystemPrompt: null } as never,
    });
    const patch = { mcp: { injectIntoAgents: true }, autoArchiveAfterMerge: true, appendSystemPrompt: null, unknownKey: 1 } as never;
    const result = await patchConfigVerified(fake.client, patch);
    expect(fake.patchDaemonConfig).toHaveBeenCalledWith(patch);
    expect(result).toEqual({ applied: ["mcp.injectIntoAgents", "appendSystemPrompt"], ignored: ["autoArchiveAfterMerge", "unknownKey"] });
  });
});
