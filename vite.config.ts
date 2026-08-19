/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/hatch3d/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["hatch3d-wasm"],
  },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
    // In-bounds sweep tests iterate many control combos; under full-suite
    // parallel load they exceed the 5s default while staying honest work.
    testTimeout: 30000,
  },
});
