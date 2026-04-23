import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: "src",
  envDir: "..",
  server: {
    proxy: {
      "/api/chat": {
        target: "http://localhost:3099",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/chat/, ""),
      },
    },
  },
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
        campaign: resolve(srcDir, "campaign.html"),
        "diagnose-levels": resolve(srcDir, "diagnose-levels.html"),
        game: resolve(srcDir, "game.html"),
        diagnose: resolve(srcDir, "diagnose.html"),
        sandbox: resolve(srcDir, "sandbox.html"),
        credits: resolve(srcDir, "credits.html"),
      },
    },
  },
});
