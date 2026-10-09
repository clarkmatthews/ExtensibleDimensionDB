import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { AUTH_SECRET: "test-secret-that-is-long-enough-for-the-check-1234567890" },
  },
});
