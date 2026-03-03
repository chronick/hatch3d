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
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
