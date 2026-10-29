import { defineConfig } from "vitest/config";

export default defineConfig({
  // One file at a time: the suites share W, L and the hub, and some change them (companion consent, plugins, saved hosts).
  test: { include: ["test/integration/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
