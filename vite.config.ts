import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: "src",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@sim": fileURLToPath(new URL("./src/sim", import.meta.url)),
      "@capabilities": fileURLToPath(new URL("./src/capabilities", import.meta.url)),
      "@harness": fileURLToPath(new URL("./tests/harness", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(srcDir, "index.html"),
        levels: resolve(srcDir, "levels.html"),
        game: resolve(srcDir, "game.html"),
      },
    },
  },
});
