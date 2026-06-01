import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;
const apiProxyTarget = nodeEnv?.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
