import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 15000,
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/db-types.d.ts",
        "vitest.config.ts",
        "src/storage/postgres.ts",
        "src/storage/mysql.ts",
        "src/storage/sqlite.ts",
        "src/index.ts",
        "src/storage/chat-storage.ts",
      ],
    },
  },
});
