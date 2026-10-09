import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  clearScreen: false,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
            { name: "ui", test: /node_modules\/(radix-ui|@radix-ui)\// },
            {
              name: "motion",
              test: /node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//,
            },
          ],
        },
      },
    },
  },
});
