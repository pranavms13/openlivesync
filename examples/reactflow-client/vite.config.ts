import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "@openlivesync/client",
      "@xyflow/react",
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/live": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
