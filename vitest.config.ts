import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/unit/game/**", "happy-dom"],
      // Any test that transitively imports a Pixi renderer needs a DOM
      // environment so Pixi's BrowserAdapter can read `navigator`.
      ["tests/unit/level-id-param.test.ts", "happy-dom"],
    ],
  },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@sim": fileURLToPath(new URL("./src/sim", import.meta.url)),
      "@capabilities": fileURLToPath(new URL("./src/capabilities", import.meta.url)),
      "@harness": fileURLToPath(new URL("./tests/harness", import.meta.url)),
    },
  },
});
