import { configDefaults, defineConfig } from "vitest/config"

/** Explicit-only live evaluation or offline replay; never part of npm test. */
export default defineConfig({
  test: {
    environment: "node", maxWorkers: 1, fileParallelism: false,
    include: ["apps/web/src/agent/fixtures/examSolid30.eval.test.ts"],
    exclude: [...configDefaults.exclude]
  }
})
