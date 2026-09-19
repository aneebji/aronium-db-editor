import { defineConfig } from "vite";

const pages = process.env.PAGES === "1";

export default defineConfig({
  base: pages ? "/aronium-db-editor/" : "/",
  build: {
    outDir: pages ? "docs" : "dist",
    emptyOutDir: true,
  },
  worker: {
    format: "es",
  },
});
