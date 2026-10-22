import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
