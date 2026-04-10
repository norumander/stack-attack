import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@capabilities": fileURLToPath(new URL("./src/capabilities", import.meta.url)),
      "@harness": fileURLToPath(new URL("./tests/harness", import.meta.url)),
    },
  },
});
