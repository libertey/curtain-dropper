import { defineConfig } from "vite";

export default defineConfig({
  base: "/curtain-dropper/",
  build: {
    target: "es2018",
    outDir: "dist-demo",
    emptyOutDir: true,
  },
});
