import { defineConfig } from "vitest/config"

// Explicit, offline-only diagnostic entry point; never imports the live evaluation.
export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./test-setup.ts"],
    include: ["scripts/agent-failure-audit/current.probe.mjs"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30000
  }
})
