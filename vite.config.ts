import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("@fullcalendar") || id.includes("luxon")) {
            return "vendor-calendar";
          }

          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }

          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }

          if (id.includes("@supabase")) {
            return "vendor-supabase";
          }

          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }

          if (id.includes("react") || id.includes("@tanstack/react-query")) {
            return "vendor-react";
          }

          if (
            id.includes("recharts") ||
            id.includes("victory-vendor") ||
            id.includes("recharts-scale") ||
            id.includes("/d3-")
          ) {
            return "vendor-recharts";
          }

          if (id.includes("lodash")) {
            return "vendor-lodash";
          }

          if (id.includes("@floating-ui")) {
            return "vendor-floating";
          }

          if (id.includes("sonner")) {
            return "vendor-sonner";
          }

          if (id.includes("embla-carousel")) {
            return "vendor-embla";
          }

          return "vendor-misc";
        },
      },
    },
  },
}));
