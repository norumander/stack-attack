import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/dashboard",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@capabilities": fileURLToPath(new URL("./src/capabilities", import.meta.url)),
      "@modes": fileURLToPath(new URL("./src/modes", import.meta.url)),
      "@harness": fileURLToPath(new URL("./tests/harness", import.meta.url)),
    },
  },
});
