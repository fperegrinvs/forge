import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    // 1420 is reserved for the embedded desktop app-server (single origin).
    port: 5173,
    strictPort: true
  }
});
