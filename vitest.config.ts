import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: false,
    // Every test file runs with config, state and cache pointed at a temporary directory. See the
    // file for why this is not optional.
    setupFiles: ["src/testing/sandbox.ts", "src/testing/unscripted.ts"],
  },
})
