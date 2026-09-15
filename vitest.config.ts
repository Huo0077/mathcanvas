import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/"
      }
    },
    setupFiles: ["./test-setup.ts"],
    globals: true,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx", "scripts/**/*.test.ts"]
  }
})
