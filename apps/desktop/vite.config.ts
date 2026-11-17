import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, host: "127.0.0.1", port: 38147 },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    sourcemap: mode !== "production",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          state: ["@tanstack/react-query", "zustand"],
          visuals: ["lucide-react", "motion"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: true,
  },
}));
