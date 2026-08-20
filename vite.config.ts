/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: "/hatch3d/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["hatch3d-wasm"],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      // Two pages: the main app, and the standalone InkSight report tool
      // (served at /hatch3d/inksight/).
      input: {
        main: entry("./index.html"),
        inksight: entry("./inksight/index.html"),
      },
    },
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
