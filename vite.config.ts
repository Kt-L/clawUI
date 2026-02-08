import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devPort = Number(process.env.PORT) || 5178;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: devPort,
    strictPort: false,
  },
});
