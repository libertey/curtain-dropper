import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "es2018",
    lib: {
      entry: resolve(__dirname, "src/index.js"),
      name: "CurtainDropper",
      fileName: "curtain-dropper",
    },
    minify: "esbuild",
    sourcemap: true,
  },
});
