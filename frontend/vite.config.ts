import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
export default defineConfig(({mode}) => {
  const base = mode === "pages" ? "/sg-real-time-flights/" : "/";
  return {
  base,
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `node_modules/cesium/Build/Cesium/${dir}`,
        dest: "cesium",
        rename: { stripBase: 4 },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`) },
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8017",
      "/ws": { target: "ws://127.0.0.1:8017", ws: true },
    },
  },
  preview: {
    port: 4177,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8017",
      "/ws": { target: "ws://127.0.0.1:8017", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 4000 },
  test: { exclude: ["e2e/**", "node_modules/**"] },
} as any;
});
