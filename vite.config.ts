import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["apple-touch-icon.png"],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        name: "Aulas Particulares Alliance",
        short_name: "Alliance",
        description: "Agendamento de aulas particulares",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
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

          return undefined;
        },
      },
    },
  },
}));
